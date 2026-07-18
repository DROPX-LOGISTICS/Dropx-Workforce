import * as XLSX from "xlsx";
import { getAuthorization } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

type RequestRow = {
  id: string;
  request_no: string;
  location_code: string;
  amount: number | null;
  bank_account_no: string | null;
  ifsc: string | null;
  account_holder_name: string | null;
  contact_no: string | null;
  email: string | null;
  remarks: string | null;
  status: string;
  created_at: string;
  payment_head_id: string;
  payment_process_role_ids: string[] | null;
  payment_heads?: { code: string; name: string; external_id: string | null } | null;
};

type AnswerRow = {
  payment_request_id: string;
  answer_value: string | null;
  file_name: string | null;
  payment_head_questions?: { question_text: string } | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function safeSheetValue(value: unknown) {
  if (value == null) return "";
  return String(value);
}

export async function GET() {
  try {
    const authorization = await getAuthorization();
    if (!authorization) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const companyId = requireCompanyId(authorization);
    if (!supabaseAdmin) return Response.json({ error: "Supabase service role key is not configured" }, { status: 500 });
    if (!authorization.roleId) return Response.json({ error: "Payment process role not available." }, { status: 403 });

    const { data: requestData, error: requestError } = await supabaseAdmin
      .from("payment_requests")
      .select(`
        id,
        request_no,
        location_code,
        amount,
        bank_account_no,
        ifsc,
        account_holder_name,
        contact_no,
        email,
        remarks,
        status,
        created_at,
        payment_head_id,
        payment_process_role_ids,
        payment_heads ( code, name, external_id )
      `)
      .eq("company_id", companyId)
      .eq("status", "approved")
      .contains("payment_process_role_ids", [authorization.roleId])
      .order("created_at", { ascending: false });
    if (requestError) throw new Error(requestError.message);

    const requests = ((requestData ?? []) as unknown as RequestRow[]).map((request) => ({
      ...request,
      payment_heads: firstRelation(request.payment_heads)
    }));
    const requestIds = requests.map((request) => request.id);
    const answersResult = requestIds.length ? await supabaseAdmin
      .from("payment_request_answers")
      .select("payment_request_id, answer_value, file_name, payment_head_questions ( question_text )")
      .eq("company_id", companyId)
      .in("payment_request_id", requestIds) : { data: [], error: null };
    if (answersResult.error) throw new Error(answersResult.error.message);

    const answersByRequest = new Map<string, Record<string, string>>();
    ((answersResult.data ?? []) as unknown as AnswerRow[]).forEach((answer) => {
      const question = firstRelation(answer.payment_head_questions);
      const row = answersByRequest.get(answer.payment_request_id) ?? {};
      row[question?.question_text ?? "Field"] = answer.file_name || answer.answer_value || "";
      answersByRequest.set(answer.payment_request_id, row);
    });

    const rows = requests.map((request) => ({
      "Request No": request.request_no,
      "Location": request.location_code,
      "Payment Head Code": request.payment_heads?.code ?? "",
      "Payment Head": request.payment_heads?.name ?? "",
      "External ID": request.payment_heads?.external_id ?? "",
      "Amount": request.amount ?? "",
      "Bank Account No": request.bank_account_no ?? "",
      "IFSC": request.ifsc ?? "",
      "Acc Holder Name": request.account_holder_name ?? "",
      "Contact No": request.contact_no ?? "",
      "Email": request.email ?? "",
      "Status": request.status,
      "Remarks": request.remarks ?? "",
      "Created": new Date(request.created_at).toLocaleDateString("en-GB"),
      ...Object.fromEntries(Object.entries(answersByRequest.get(request.id) ?? {}).map(([key, value]) => [key, safeSheetValue(value)]))
    }));

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, "Payment Requests");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const body = new Uint8Array(buffer);
    return new Response(body, {
      headers: {
        "Content-Disposition": `attachment; filename="payment-requests-${Date.now()}.xlsx"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to download payment data." }, { status: 500 });
  }
}
