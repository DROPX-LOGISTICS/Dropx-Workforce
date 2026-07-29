import { supabaseAdmin } from "@/lib/supabase-admin";

export type CapacityAdHocUsage = {
  stationCode: string;
  workDate: string;
  externalDaCount: number;
  paymentRequests: number;
  trackingIds: string[];
};

type PaymentHeadRow = {
  id: string;
  code: string | null;
  name: string | null;
};

type PaymentRequestRow = {
  id: string;
  location_code: string | null;
  station_code: string | null;
  work_date: string | null;
  requested_for_name: string | null;
  status: string | null;
  approval_status: string | null;
  current_approver_user_id: string | null;
  current_approver_role_id: string | null;
};

type PaymentAnswerRow = {
  payment_request_id: string;
  question_id: string;
  answer_value: string | null;
};

type PaymentQuestionRow = {
  id: string;
  question_text: string | null;
};

function normalized(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function isAdHocDaHead(head: PaymentHeadRow) {
  const code = normalized(head.code);
  const name = normalized(head.name);
  const candidate = `${code}_${name}`;
  return candidate.includes("ADHOC") && (candidate.includes("_DA") || candidate.includes("DRIVER"));
}

function isFinalApproved(request: PaymentRequestRow) {
  const status = normalized(request.status);
  const approval = normalized(request.approval_status);
  if (["REJECTED", "RETURNED", "CANCELLED"].includes(status) || ["REJECTED", "RETURNED", "CANCELLED"].includes(approval)) {
    return false;
  }
  if (["APPROVED", "PROCESSING", "PROCESSED"].includes(status) || ["APPROVED", "PROCESSING", "PROCESSED"].includes(approval)) {
    return true;
  }
  return (status === "OWNER_APPROVED" || approval === "OWNER_APPROVED" || approval.endsWith("_APPROVED"))
    && !request.current_approver_user_id
    && !request.current_approver_role_id;
}

function validDate(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function trackingIds(value: unknown) {
  return [...new Set(String(value ?? "")
    .split(/[\n,;|]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean))];
}

export async function loadApprovedCapacityAdHocUsage(companyId: string, from: string, to: string) {
  if (!supabaseAdmin) return { rows: [] as CapacityAdHocUsage[], error: "Database service is unavailable." };

  const headResult = await supabaseAdmin.from("payment_heads")
    .select("id,code,name")
    .eq("company_id", companyId);
  if (headResult.error) return { rows: [] as CapacityAdHocUsage[], error: headResult.error.message };
  const eligibleHeads = ((headResult.data ?? []) as PaymentHeadRow[]).filter(isAdHocDaHead);
  const headIds = eligibleHeads.map((head) => head.id);
  if (!headIds.length) return { rows: [] as CapacityAdHocUsage[], error: null };

  const requestResult = await supabaseAdmin.from("payment_requests")
    .select("id,location_code,station_code,work_date,requested_for_name,status,approval_status,current_approver_user_id,current_approver_role_id")
    .eq("company_id", companyId)
    .in("payment_head_id", headIds)
    .lte("work_date", to);
  if (requestResult.error) return { rows: [] as CapacityAdHocUsage[], error: requestResult.error.message };
  const requests = ((requestResult.data ?? []) as PaymentRequestRow[]).filter(isFinalApproved);
  if (!requests.length) return { rows: [] as CapacityAdHocUsage[], error: null };

  const requestIds = requests.map((request) => request.id);
  const answerResult = await supabaseAdmin.from("payment_request_answers")
    .select("payment_request_id,question_id,answer_value")
    .eq("company_id", companyId)
    .in("payment_request_id", requestIds);
  if (answerResult.error) return { rows: [] as CapacityAdHocUsage[], error: answerResult.error.message };
  const answers = (answerResult.data ?? []) as PaymentAnswerRow[];
  const questionIds = [...new Set(answers.map((answer) => answer.question_id).filter(Boolean))];
  const questionResult = questionIds.length
    ? await supabaseAdmin.from("payment_head_questions").select("id,question_text").in("id", questionIds)
    : { data: [] as PaymentQuestionRow[], error: null };
  if (questionResult.error) return { rows: [] as CapacityAdHocUsage[], error: questionResult.error.message };
  const questions = new Map(((questionResult.data ?? []) as PaymentQuestionRow[]).map((question) => [question.id, normalized(question.question_text)]));
  const byRequest = new Map<string, PaymentAnswerRow[]>();
  answers.forEach((answer) => {
    const current = byRequest.get(answer.payment_request_id) ?? [];
    current.push(answer);
    byRequest.set(answer.payment_request_id, current);
  });

  type MutableUsage = { stationCode: string; workDate: string; anonymous: Set<string>; requestIds: Set<string>; trackingIds: Set<string> };
  const usage = new Map<string, MutableUsage>();
  requests.forEach((request) => {
    const requestAnswers = byRequest.get(request.id) ?? [];
    const deploymentDate = requestAnswers.find((answer) => {
      const question = questions.get(answer.question_id) ?? "";
      return question.includes("DEPLOYMENT") && question.includes("DATE");
    });
    const workDate = validDate(deploymentDate?.answer_value) ?? validDate(request.work_date);
    const stationCode = normalized(request.station_code || request.location_code);
    if (!workDate || workDate < from || workDate > to || !stationCode) return;
    const idAnswers = requestAnswers.filter((answer) => {
      const question = questions.get(answer.question_id) ?? "";
      return question.includes("TRACKING") && (question.includes("ID") || question.includes("ASSOCIATE"));
    });
    const ids = [...new Set(idAnswers.flatMap((answer) => trackingIds(answer.answer_value)))];
    const key = `${stationCode}|${workDate}`;
    const current = usage.get(key) ?? {
      stationCode,
      workDate,
      anonymous: new Set<string>(),
      requestIds: new Set<string>(),
      trackingIds: new Set<string>()
    };
    current.requestIds.add(request.id);
    if (ids.length) ids.forEach((id) => current.trackingIds.add(id));
    else current.anonymous.add(request.id);
    usage.set(key, current);
  });

  const rows = [...usage.values()].map((row): CapacityAdHocUsage => ({
    stationCode: row.stationCode,
    workDate: row.workDate,
    externalDaCount: row.trackingIds.size + row.anonymous.size,
    paymentRequests: row.requestIds.size,
    trackingIds: [...row.trackingIds].sort()
  })).sort((left, right) => left.workDate.localeCompare(right.workDate) || left.stationCode.localeCompare(right.stationCode));
  return { rows, error: null };
}
