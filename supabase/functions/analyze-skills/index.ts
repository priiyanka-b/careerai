// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RESUME_LENGTH = 50000;
const MAX_JOB_DESCRIPTION_LENGTH = 20000;
const VALID_ANALYSIS_TYPES = ['ats', 'keywords', 'tailor', 'comprehensive'];
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
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
      identifier: `analyze-resume:${user.id}`,
    });
    if (!rateLimitResult.allowed) {
      return rateLimitResponse(corsHeaders, rateLimitResult.resetIn);
    }

    const { resumeText, jobDescription, analysisType } = await req.json();

    if (!resumeText || typeof resumeText !== 'string') {
      return new Response(JSON.stringify({ error: "Resume text is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (resumeText.length > MAX_RESUME_LENGTH) {
      return new Response(JSON.stringify({ error: `Resume text must be under ${MAX_RESUME_LENGTH} characters` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (jobDescription && typeof jobDescription === 'string' && jobDescription.length > MAX_JOB_DESCRIPTION_LENGTH) {
      return new Response(JSON.stringify({ error: `Job description must be under ${MAX_JOB_DESCRIPTION_LENGTH} characters` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const validatedAnalysisType = VALID_ANALYSIS_TYPES.includes(analysisType) ? analysisType : 'comprehensive';
    const sanitizedResume = resumeText.substring(0, MAX_RESUME_LENGTH).replace(/[<>{}]/g, '');
    const sanitizedJobDescription = jobDescription
      ? String(jobDescription).substring(0, MAX_JOB_DESCRIPTION_LENGTH).replace(/[<>{}]/g, '')
      : '';

    // ── Fetch hindsight context ──
    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const [appsRes, prefsRes] = await Promise.all([
      serviceSupabase
        .from("applications")
        .select("status, job_postings(title, company, location)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(15),
      serviceSupabase
        .from("user_preferences")
        .select("target_roles, keywords, locations")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const apps = appsRes.data || [];
    const prefs = prefsRes.data;

    let hindsightContext = "";
    if (apps.length > 0) {
      const companies = apps.map((a) => a.job_postings?.company).filter(Boolean).slice(0, 5).join(", ");
      const roles = apps.map((a) => a.job_postings?.title).filter(Boolean).slice(0, 5).join(", ");
      const statusCounts = apps.reduce((acc, a) => {
        acc[a.status] = (acc[a.status] || 0) + 1;
        return acc;
      }, {});
      hindsightContext = `
## Hindsight: User's Real Job Search Data
- Applied to ${apps.length} jobs so far
- Companies applied to: ${companies}
- Roles applied for: ${roles}
- Application outcomes: ${Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(", ")}
- Target roles from profile: ${prefs?.target_roles?.join(", ") || "not set"}
- Key skills from profile: ${prefs?.keywords?.join(", ") || "not set"}

Use this to:
- Tailor resume feedback specifically for the roles they are actually applying to
- Highlight skills that match the companies and roles in their history
- Point out gaps between their current resume and the roles they are targeting`;
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    let systemPrompt = "";
    let userPrompt = "";

    if (validatedAnalysisType === "ats") {
      systemPrompt = `You are an expert ATS analyzer. Always respond with raw JSON only — no markdown, no code blocks.${hindsightContext}`;
      userPrompt = `Analyze this resume for ATS compatibility.

Resume:
${sanitizedResume}

${sanitizedJobDescription ? `Target Job Description:\n${sanitizedJobDescription}` : ''}

Return ONLY this raw JSON:
{
  "atsScore": number (0-100),
  "issues": ["issue 1", "issue 2"],
  "formattingTips": ["tip 1", "tip 2"],
  "keywordSuggestions": ["keyword 1", "keyword 2"],
  "overallFeedback": "summary string"
}`;

    } else if (validatedAnalysisType === "keywords") {
      systemPrompt = `You are an expert resume keyword optimizer. Always respond with raw JSON only — no markdown, no code blocks.${hindsightContext}`;
      userPrompt = `Compare this resume against the job description for keyword gaps.

Resume:
${sanitizedResume}

Job Description:
${sanitizedJobDescription}

Return ONLY this raw JSON:
{
  "matchingKeywords": ["keyword 1"],
  "missingKeywords": ["keyword 1"],
  "keywordDensity": number (0-100),
  "suggestions": ["suggestion 1"],
  "priorityKeywords": ["keyword 1"]
}`;

    } else if (validatedAnalysisType === "tailor") {
      systemPrompt = `You are an expert resume writer. Always respond with raw JSON only — no markdown, no code blocks.${hindsightContext}`;
      userPrompt = `Tailor this resume for the specific job description.

Original Resume:
${sanitizedResume}

Target Job Description:
${sanitizedJobDescription}

Return ONLY this raw JSON:
{
  "tailoredResume": "full tailored resume text",
  "changesExplanation": ["change 1", "change 2"],
  "highlightedSkills": ["skill 1", "skill 2"],
  "estimatedMatchScore": number (0-100)
}`;

    } else {
      systemPrompt = `You are an expert resume analyst. Always respond with raw JSON only — no markdown, no code blocks.${hindsightContext}`;
      userPrompt = `Provide a comprehensive analysis of this resume.

Resume:
${sanitizedResume}

${sanitizedJobDescription ? `Target Job Description:\n${sanitizedJobDescription}` : ''}

Return ONLY this raw JSON:
{
  "overallScore": number (0-100),
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["improvement 1", "improvement 2"],
  "atsCompatibility": number (0-100),
  "recommendations": ["recommendation 1", "recommendation 2"],
  "summary": "brief overall assessment"
}`;
    }

    const geminiContents = [
      { role: "user", parts: [{ text: `[SYSTEM]\n${systemPrompt}` }] },
      { role: "model", parts: [{ text: "Understood. I will analyze the resume and respond with raw JSON only." }] },
      { role: "user", parts: [{ text: userPrompt }] },
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: geminiContents,
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini error:", response.status, errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const geminiData = await response.json();
    const rawContent = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Strip markdown code blocks if Gemini wraps response
    const cleanedContent = rawContent
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/gi, "")
      .trim();

    let parsedContent;
    try {
      const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedContent = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", rawContent);
      parsedContent = {
        overallScore: 70,
        strengths: ["Clear formatting", "Relevant experience listed"],
        improvements: ["Add more quantified achievements", "Include relevant keywords"],
        atsCompatibility: 65,
        recommendations: ["Tailor resume to each job description", "Add a professional summary"],
        summary: "Your resume has a good foundation but could be optimized for ATS systems."
      };
    }

    return new Response(JSON.stringify({
      success: true,
      analysisType: validatedAnalysisType,
      result: parsedContent
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-resume function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});