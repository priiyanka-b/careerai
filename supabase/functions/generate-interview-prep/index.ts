// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { interviewId } = await req.json();
    if (!interviewId || typeof interviewId !== "string") {
      return new Response(JSON.stringify({ error: "Invalid interviewId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch interview with job info
    const { data: interview, error: interviewError } = await supabase
      .from("interviews")
      .select(`
        *,
        applications (
          job_postings ( title, company, description, location, job_type )
        )
      `)
      .eq("id", interviewId)
      .eq("user_id", user.id)
      .single();

    if (interviewError || !interview) {
      return new Response(JSON.stringify({ error: "Interview not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jobTitle = interview.applications?.job_postings?.title || "the role";
    const company = interview.applications?.job_postings?.company || "the company";
    const description = interview.applications?.job_postings?.description || "";
    const interviewType = interview.interview_type || "general";

    // Fetch user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();

    // ── Fetch hindsight context ──
    const [feedbackRes, prevInterviewsRes] = await Promise.all([
      supabase
        .from("interview_feedback")
        .select("outcome, difficulty_rating, could_improve, went_well, questions_asked")
        .eq("user_id", user.id)
        .limit(5),
      supabase
        .from("interviews")
        .select("interview_type, notes")
        .eq("user_id", user.id)
        .neq("id", interviewId)
        .order("scheduled_at", { ascending: false })
        .limit(3),
    ]);

    const feedback = feedbackRes.data || [];
    const prevInterviews = prevInterviewsRes.data || [];

    let hindsightContext = "";
    if (feedback.length > 0) {
      const improvements = feedback.map(f => f.could_improve).filter(Boolean).join("; ");
      const strengths = feedback.map(f => f.went_well).filter(Boolean).join("; ");
      const pastQuestions = feedback.map(f => f.questions_asked).filter(Boolean).join("; ");
      hindsightContext = `
## Hindsight: Past Interview Experience
- Previous interviews logged: ${feedback.length}
- Known weak areas: ${improvements || "none recorded"}
- Known strengths: ${strengths || "none recorded"}
- Questions asked before: ${pastQuestions || "none recorded"}
Use this to focus the prep checklist on their actual weak areas.`;
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const systemPrompt = `You are an expert career coach. Generate a comprehensive interview preparation checklist. Always respond with raw JSON only — no markdown, no code blocks, no backticks.${hindsightContext}`;

    const userPrompt = `Generate interview prep for:
- Role: ${jobTitle}
- Company: ${company}
- Interview Type: ${interviewType}
- Job Description: ${description.slice(0, 1000)}
- Candidate: ${profile?.full_name || "the candidate"}

Tailor the preparation to the specific company and role. Include 5-8 common questions, 4-6 talking points, and 8-10 checklist items.

Return ONLY this raw JSON:
{
  "companyResearch": {
    "overview": "Brief company overview",
    "culture": "Company culture insights",
    "recentNews": ["news item 1", "news item 2"],
    "keyProducts": ["product 1", "product 2"],
    "competitors": ["competitor 1", "competitor 2"]
  },
  "commonQuestions": [
    {"question": "Question text", "tip": "How to answer", "category": "behavioral|technical|situational"}
  ],
  "talkingPoints": [
    {"point": "Key talking point", "context": "When to use"}
  ],
  "checklist": [
    {"item": "Preparation task", "priority": "high|medium|low"}
  ],
  "dosDonts": {
    "dos": ["Do this"],
    "donts": ["Don't do this"]
  }
}`;

    const geminiContents = [
      { role: "user", parts: [{ text: `[SYSTEM]\n${systemPrompt}` }] },
      { role: "model", parts: [{ text: "Understood. I will generate interview prep and respond with raw JSON only." }] },
      { role: "user", parts: [{ text: userPrompt }] },
    ];

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: geminiContents,
          generationConfig: { temperature: 0.4, maxOutputTokens: 2000 },
        }),
      }
    );

    let prepData = null;

    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      const rawContent = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const cleanedContent = rawContent
        .replace(/```json\n?/gi, "")
        .replace(/```\n?/gi, "")
        .trim();
      try {
        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          prepData = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.error("Failed to parse AI response:", e);
      }
    }

    // Fallback if AI fails
    if (!prepData) {
      prepData = {
        companyResearch: {
          overview: `${company} is hiring for ${jobTitle}. Research the company website for more details.`,
          culture: "Visit Glassdoor and LinkedIn to learn about company culture.",
          recentNews: ["Check Google News for recent company updates"],
          keyProducts: ["Research main products/services on company website"],
          competitors: ["Identify key competitors in the industry"],
        },
        commonQuestions: [
          { question: "Tell me about yourself", tip: "Keep it professional, 2 minutes max, highlight relevant experience", category: "behavioral" },
          { question: "Why do you want to work here?", tip: "Connect your goals to company mission", category: "behavioral" },
          { question: "What are your strengths?", tip: "Use STAR method with concrete examples", category: "behavioral" },
          { question: "Describe a challenging project", tip: "Focus on problem-solving and results", category: "situational" },
          { question: "Where do you see yourself in 5 years?", tip: "Show ambition aligned with company growth", category: "behavioral" },
        ],
        talkingPoints: [
          { point: "Your relevant experience and skills", context: "Opening and throughout" },
          { point: "Specific projects demonstrating impact", context: "Technical questions" },
          { point: "Questions about team and growth", context: "Your turn to ask questions" },
        ],
        checklist: [
          { item: "Research company website and recent news", priority: "high" },
          { item: "Review job description and match your skills", priority: "high" },
          { item: "Prepare 3-5 questions to ask interviewer", priority: "high" },
          { item: "Test video/audio setup if virtual", priority: "high" },
          { item: "Prepare STAR stories for behavioral questions", priority: "medium" },
          { item: "Review your resume and portfolio", priority: "medium" },
          { item: "Plan your outfit", priority: "low" },
          { item: "Get a good night's sleep", priority: "low" },
        ],
        dosDonts: {
          dos: ["Be punctual", "Ask thoughtful questions", "Show enthusiasm", "Use specific examples"],
          donts: ["Don't speak negatively about past employers", "Don't arrive unprepared", "Don't forget to follow up"],
        },
      };
    }

    return new Response(
      JSON.stringify({ success: true, preparation: prepData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});