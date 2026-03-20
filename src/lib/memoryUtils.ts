import { supabase } from "@/integrations/supabase/client";

export async function getUserMemoryContext(userId: string): Promise<string> {
  const { data } = await supabase
    .from("user_memory" as any)
    .select("memory_type, key, value")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(40);

  if (!data || data.length === 0) return "";

  const grouped = (data as any[]).reduce((acc, row) => {
    if (!acc[row.memory_type]) acc[row.memory_type] = [];
    acc[row.memory_type].push(`${row.key}: ${JSON.stringify(row.value)}`);
    return acc;
  }, {} as Record<string, string[]>);

  const parts: string[] = ["## What I know about this user:"];
  if (grouped.job_pref)
    parts.push(`Job preferences:\n- ${grouped.job_pref.join("\n- ")}`);
  if (grouped.interview_pattern)
    parts.push(`Interview patterns:\n- ${grouped.interview_pattern.join("\n- ")}`);
  if (grouped.career_signal)
    parts.push(`Career signals:\n- ${grouped.career_signal.join("\n- ")}`);
  if (grouped.chat_context)
    parts.push(`Past conversations:\n- ${grouped.chat_context.slice(0, 5).join("\n- ")}`);

  return parts.join("\n");
}

export async function updateUserMemory(
  userId: string,
  event: string,
  data: any
) {
  await supabase.functions.invoke("update-user-memory", {
    body: { userId, event, data },
  });
}