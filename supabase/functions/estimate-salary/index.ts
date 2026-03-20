// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { role, experienceYears, location, skills, userId } = await req.json();

    if (!role || !location) {
      return new Response(JSON.stringify({ error: "Role and location are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── Fetch hindsight context from user's real data ──
    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const [appsRes, prefsRes] = await Promise.all([
      serviceSupabase
        .from("applications")
        .select("status, job_postings(title, company, salary_range)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(15),
      serviceSupabase
        .from("user_preferences")
        .select("salary_min, target_roles, locations")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const apps = appsRes.data || [];
    const prefs = prefsRes.data;

    let hindsightContext = "";
    if (apps.length > 0) {
      const salaryRanges = apps
        .map((a) => a.job_postings?.salary_range)
        .filter(Boolean)
        .slice(0, 5)
        .join(", ");
      const companies = apps
        .map((a) => a.job_postings?.company)
        .filter(Boolean)
        .slice(0, 5)
        .join(", ");
      const offerCount = apps.filter(a => a.status === "offer").length;

      hindsightContext = `
## Hindsight: User's Real Job Search Data
- Applied to ${apps.length} jobs at companies like: ${companies}
- Salary ranges seen in applications: ${salaryRanges || "not recorded"}
- Offers received: ${offerCount}
- Minimum salary expectation from profile: ${prefs?.salary_min ? `₹${prefs.salary_min}` : "not set"}
- Target roles: ${prefs?.target_roles?.join(", ") || "not set"}
Use this to give a realistic and personalized salary estimate.`;
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const systemPrompt = `You are a salary research expert specializing in Indian and global tech job markets. Always respond with raw JSON only — no markdown, no code blocks, no backticks.${hindsightContext}`;

    const prompt = `Estimate the salary for this profile:
- Role: ${role}
- Years of Experience: ${experienceYears || 0}
- Location: ${location}
- Key Skills: ${Array.isArray(skills) ? skills.join(", ") : skills || "not specified"}

Provide a detailed salary estimate. For Indian locations use INR, for others use USD.

Return ONLY this raw JSON structure with no markdown:
{
  "estimated_min": number (annual, no commas),
  "estimated_max": number (annual, no commas),
  "estimated_median": number (annual, no commas),
  "currency": "INR" or "USD",
  "market_trend": "rising" or "stable" or "declining",
  "demand_level": "high" or "medium" or "low",
  "negotiation_tips": ["tip 1", "tip 2", "tip 3"],
  "key_factors": ["factor 1", "factor 2", "factor 3"],
  "comparable_roles": [
    {"role": "role name", "min": number, "max": number}
  ]
}`;

    const geminiContents = [
      { role: "user", parts: [{ text: `[SYSTEM]\n${systemPrompt}` }] },
      { role: "model", parts: [{ text: "Understood. I will respond with raw JSON salary data only." }] },
      { role: "user", parts: [{ text: prompt }] },
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: geminiContents,
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini error:", response.status, errText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const geminiData = await response.json();
    const rawContent = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Strip markdown code blocks if present
    const cleanedContent = rawContent
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/gi, "")
      .trim();

    let salaryData;
    try {
      const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        salaryData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Parse error:", parseError, "Raw:", rawContent);
      // Sensible fallback based on location and role
      const isIndia = location.toLowerCase().includes("india") ||
                      location.toLowerCase().includes("bangalore") ||
                      location.toLowerCase().includes("mumbai") ||
                      location.toLowerCase().includes("delhi") ||
                      location.toLowerCase().includes("hyderabad") ||
                      location.toLowerCase().includes("pune");
      salaryData = {
        estimated_min: isIndia ? 1200000 : 80000,
        estimated_max: isIndia ? 3500000 : 150000,
        estimated_median: isIndia ? 2000000 : 110000,
        currency: isIndia ? "INR" : "USD",
        market_trend: "stable",
        demand_level: "medium",
        negotiation_tips: [
          "Research market rates on Glassdoor and LinkedIn Salary",
          "Highlight unique skills and certifications",
          "Consider total compensation including ESOPs and benefits"
        ],
        key_factors: ["Experience level", "Location", "Company size", "Skill demand"],
        comparable_roles: []
      };
    }

    return new Response(JSON.stringify({
      success: true,
      data: salaryData,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in estimate-salary:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error"
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});