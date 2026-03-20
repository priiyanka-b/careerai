// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const validateUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const MAX_ROLE_LENGTH = 200;
const MAX_SKILLS = 50;
const MAX_SKILL_LENGTH = 100;
const MAX_EXPERIENCE_YEARS = 70;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60000;

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

    const rateLimitResult = checkRateLimit({
      maxRequests: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
      identifier: `predict-career:${user.id}`,
    });
    if (!rateLimitResult.allowed) {
      return rateLimitResponse(corsHeaders, rateLimitResult.resetIn);
    }

    const { userId, currentRole, skills, experienceYears } = await req.json();

    if (userId) {
      if (!validateUUID(userId)) {
        return new Response(JSON.stringify({ error: "Invalid user ID" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (user.id !== userId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (!currentRole || typeof currentRole !== 'string') {
      return new Response(JSON.stringify({ error: "Current role is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const validatedSkills = (skills || [])
      .filter((s) => typeof s === 'string' && s.length > 0)
      .slice(0, MAX_SKILLS)
      .map(s => s.substring(0, MAX_SKILL_LENGTH));

    const validatedExperience = typeof experienceYears === 'number' &&
      experienceYears >= 0 && experienceYears <= MAX_EXPERIENCE_YEARS
        ? Math.floor(experienceYears) : 0;

    const sanitizedRole = currentRole.substring(0, MAX_ROLE_LENGTH).replace(/[<>{}]/g, '');
    const sanitizedSkills = validatedSkills.join(", ");

    // ── Fetch hindsight context ──
    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const [appsRes, feedbackRes, prevPredictionsRes, prefsRes] = await Promise.all([
      serviceSupabase
        .from("applications")
        .select("status, job_postings(title, company, location)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      serviceSupabase
        
      .from("interview_feedback" as any)
      .select("outcome, difficulty_rating, overall_rating, would_recommend, could_improve")
       .eq("user_id", user.id)
       .limit(10),
      serviceSupabase
        .from("career_path_predictions")
        .select("role_title, predicted_paths, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(2),
      serviceSupabase
        .from("user_preferences")
        .select("target_roles, locations, salary_min")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const apps = appsRes.data || [];
    const feedback = (feedbackRes.data) || [];
    const prevPredictions = prevPredictionsRes.data || [];
    const prefs = prefsRes.data;

    let hindsightContext = "";

    if (apps.length > 0) {
      const statusCounts = apps.reduce((acc, a) => {
        acc[a.status] = (acc[a.status] || 0) + 1;
        return acc;
      }, {});
      const companies = apps.map((a) => a.job_postings?.company).filter(Boolean).slice(0, 5).join(", ");
      const locations = [...new Set(apps.map((a) => a.job_postings?.location).filter(Boolean))].slice(0, 3).join(", ");
      const offerCount = apps.filter(a => a.status === "offer").length;
      const interviewCount = apps.filter(a => a.status === "interview").length;

      hindsightContext += `
## Hindsight: Real Application Behaviour
- Total applications: ${apps.length}
- Companies targeted: ${companies}
- Preferred locations: ${locations}
- Interview conversion: ${interviewCount} interviews from ${apps.length} applications
- Offers received: ${offerCount}
- Status breakdown: ${Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(", ")}
- Salary expectation: ${prefs?.salary_min ? `₹${prefs.salary_min} minimum` : "not set"}
- Profile target roles: ${prefs?.target_roles?.join(", ") || "not set"}`;
    }

    if (feedback.length > 0) {
      const avgRating = (feedback.reduce((s, f) => s + (f.overall_rating || 0), 0) / feedback.length).toFixed(1);
      const outcomes = feedback.map(f => f.outcome).filter(Boolean).join(", ");
      const improvements = feedback.map(f => f.could_improve).filter(Boolean).slice(0, 3).join("; ");
      hindsightContext += `
## Hindsight: Interview Performance
- ${feedback.length} interviews logged, avg experience: ${avgRating}/5
- Outcomes: ${outcomes}
- Areas needing improvement: ${improvements || "none recorded"}
- Factor interview performance into career path realism`;
    }

    if (prevPredictions.length > 0) {
      const last = prevPredictions[0];
      const pathNames = Array.isArray(last.predicted_paths)
        ? last.predicted_paths.slice(0, 2).map((p) => p.path_name).join(", ")
        : "";
      hindsightContext += `
## Hindsight: Previous Career Predictions
- Last predicted paths: ${pathNames}
- Previously analyzed from role: ${last.role_title}
- Show how their trajectory has evolved since the last prediction`;
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const systemPrompt = `You are a career advisor. Always respond with valid JSON only.${hindsightContext}`;

    const prompt = `Analyze the career trajectory for:

Current Role: ${sanitizedRole}
Years of Experience: ${validatedExperience}
Current Skills: ${sanitizedSkills}

Use the hindsight data in your context to make paths realistic for their actual job market behaviour.

Return ONLY this JSON structure:
{
  "predicted_paths": [
    {
      "path_name": "path title",
      "description": "brief description",
      "roles": [
        {"title": "role title", "years_from_now": 0, "required_skills": ["skill1"], "description": "what this role involves"}
      ],
      "success_probability": "high|medium|low",
      "effort_required": "high|medium|low"
    }
  ],
  "industry_insights": [
    {"trend": "trend name", "impact": "positive|neutral|negative", "description": "how it affects career", "timeframe": "short-term|medium-term|long-term"}
  ],
  "salary_progression": [
    {"years_experience": 0, "role": "current role", "min_salary": 50000, "max_salary": 80000, "median_salary": 65000}
  ]
}`;

    const geminiContents = [
      { role: "user", parts: [{ text: `[SYSTEM]\n${systemPrompt}` }] },
      { role: "model", parts: [{ text: "Understood. I will predict career paths using the user's real job search history." }] },
      { role: "user", parts: [{ text: prompt }] },
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: geminiContents,
          generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini error:", response.status, errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let prediction;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        prediction = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (parseError) {
      console.error("Parse error:", parseError);
      prediction = {
        predicted_paths: [{
          path_name: "Career Growth Path",
          description: "Natural progression in your field",
          roles: [
            { title: sanitizedRole, years_from_now: 0, required_skills: validatedSkills.slice(0, 3), description: "Current position" },
            { title: "Senior " + sanitizedRole, years_from_now: 2, required_skills: ["Leadership", "Strategy"], description: "Advanced role" }
          ],
          success_probability: "high",
          effort_required: "medium"
        }],
        industry_insights: [{ trend: "Growing Demand", impact: "positive", description: "Industry shows consistent growth", timeframe: "medium-term" }],
        salary_progression: [{ years_experience: validatedExperience, role: sanitizedRole, min_salary: 50000, max_salary: 80000, median_salary: 65000 }]
      };
    }

    // Save to DB
    await serviceSupabase.from("career_path_predictions").insert({
      user_id: user.id,
      role_title: sanitizedRole,
      skills: validatedSkills,
      experience_years: validatedExperience,
      predicted_paths: prediction.predicted_paths,
      industry_insights: prediction.industry_insights,
      salary_progression: prediction.salary_progression,
    });

    return new Response(JSON.stringify(prediction), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in predict-career:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});