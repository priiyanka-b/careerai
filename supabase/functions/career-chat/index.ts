// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract hindsightContext sent from the frontend
    const { message, conversationHistory, hindsightContext } = await req.json();
    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // RECALL: Fetch user's past memories for context
    const { data: memories } = await serviceSupabase
      .from("chat_memories")
      .select("content, role, memory_type, metadata, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    // Fetch user profile for personalization
    const { data: profile } = await serviceSupabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    // Fetch user preferences
    const { data: prefs } = await serviceSupabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // Fetch recent applications for context
    const { data: recentApps } = await serviceSupabase
      .from("applications")
      .select("status, created_at, job_postings(title, company)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);

    // Build memory context from chat_memories table
    const memoryContext = memories?.length
      ? memories
          .filter(m => m.memory_type === "insight" || m.memory_type === "learning")
          .map(m => `[${m.memory_type}] ${m.content}`)
          .join("\n")
      : "No prior memories yet.";

    const profileContext = profile
      ? `User: ${profile.full_name || "Unknown"}, Skills: ${prefs?.keywords?.join(", ") || "Not set"}, Target Roles: ${prefs?.target_roles?.join(", ") || "Not set"}, Locations: ${prefs?.locations?.join(", ") || "Any"}`
      : "Profile not completed.";

    const appContext = recentApps?.length
      ? `Recent applications: ${recentApps.map((a) => `${a.job_postings?.title} at ${a.job_postings?.company} (${a.status})`).join("; ")}`
      : "No applications yet.";

    // Build the system prompt with hindsight memory injected
    const systemPrompt = `You are CareerPilot AI — an intelligent career advisor with persistent memory. You remember past conversations and learn from user interactions to provide increasingly personalized advice.

## User Profile
${profileContext}

## Recent Application Activity
${appContext}

## Chat Memory (Past Learnings & Insights)
${memoryContext}
${hindsightContext ? `
## Hindsight Memory (Learned from user's real job search behaviour)
${hindsightContext}

Use this hindsight memory to:
- Reference specific companies or roles the user has already applied to
- Avoid suggesting roles or companies they have repeatedly skipped or been rejected from
- Highlight patterns e.g. "You seem to apply mostly to startups in Bangalore"
- Give targeted interview advice based on their logged weak areas
- Celebrate wins e.g. offers or passed interviews they have logged
- If they have upcoming interviews, proactively help them prepare` : ""}

## Your Behaviour
- Use memories to avoid repeating suggestions the user has already acted on
- Track what skills the user has learned and suggest the next logical step
- Reference past conversations naturally e.g. "Last time you mentioned..."
- If the user has applied to frontend roles mostly, suggest related but expanding opportunities
- Provide actionable, specific advice — not generic platitudes
- When giving resume feedback, reference their actual skills and target roles
- Format responses with markdown for readability

## Key Capabilities
1. Career advice personalized to user's journey
2. Resume analysis and improvement suggestions
3. Skill gap identification and learning roadmaps
4. Internship/job strategy based on application history
5. Interview preparation tailored to their target roles`;

    // Build messages array for Gemini
    // Gemini doesn't use "system" role — we inject it as first user message
    const chatHistory = (conversationHistory || []).slice(-10);

    // ── GEMINI API (replaces Lovable gateway) ──
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("Gemini API key not configured. Run: npx supabase secrets set GEMINI_API_KEY=your-key");
    }

    // Convert messages to Gemini format
    const geminiContents = [
      // Inject system prompt as first user turn (Gemini doesn't have system role in this API)
      {
        role: "user",
        parts: [{ text: `[SYSTEM INSTRUCTIONS - follow these throughout the conversation]\n${systemPrompt}` }],
      },
      {
        role: "model",
        parts: [{ text: "Understood! I'm CareerPilot AI with full context about this user. I'll provide personalized career advice based on their history and profile." }],
      },
      // Add conversation history
      ...chatHistory.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      // Add current message
      {
        role: "user",
        parts: [{ text: message }],
      },
    ];

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: geminiContents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("Gemini API error:", aiResponse.status, errText);
      throw new Error("AI service unavailable");
    }

    const aiData = await aiResponse.json();
    const assistantMessage = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "I'm sorry, I couldn't generate a response.";

    // RETAIN: Store both user message and AI response for future recall
    await serviceSupabase.from("chat_memories").insert([
      {
        user_id: user.id,
        role: "user",
        content: message,
        memory_type: "conversation",
        metadata: { timestamp: new Date().toISOString() },
      },
      {
        user_id: user.id,
        role: "assistant",
        content: assistantMessage,
        memory_type: "conversation",
        metadata: { timestamp: new Date().toISOString() },
      },
    ]);

    // REFLECT: Extract and store insights if the user shares new info
    const lowerMsg = message.toLowerCase();
    if (
      lowerMsg.includes("learned") ||
      lowerMsg.includes("completed") ||
      lowerMsg.includes("got offer") ||
      lowerMsg.includes("rejected") ||
      lowerMsg.includes("my skills")
    ) {
      await serviceSupabase.from("chat_memories").insert({
        user_id: user.id,
        role: "system",
        content: `User update: ${message}`,
        memory_type: "insight",
        metadata: { extracted_from: "user_message", timestamp: new Date().toISOString() },
      });
    }

    return new Response(JSON.stringify({
      response: assistantMessage,
      hasMemory: (memories?.length || 0) > 0 || !!hindsightContext,
      memoriesUsed: (memories?.filter(m => m.memory_type === "insight").length || 0) + (hindsightContext ? 1 : 0),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Career chat error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error"
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});