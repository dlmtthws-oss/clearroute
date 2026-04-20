import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@1.35.7";

const TRUELAYER_TRANSACTIONS_URL = "https://api.truelayer.com/api/v1/transactions";

const CORSHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TrueLayerTransaction {
  transaction_id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  transaction_type: string;
  merchant_name?: string;
  category?: string;
}

interface SyncRequest {
  connectionId: string;
  userId: string;
  daysBack?: number;
}

async function refreshTokenIfNeeded(supabase, refreshToken: string): Promise<string | null> {
  const clientId = Deno.env.get("TRUELAYER_CLIENT_ID");
  const clientSecret = Deno.env.get("TRUELAYER_CLIENT_SECRET");

  if (!clientId || !clientSecret) return null;

  const formData = new URLSearchParams();
  formData.set("grant_type", "refresh_token");
  formData.set("client_id", clientId);
  formData.set("client_secret", clientSecret);
  formData.set("refresh_token", refreshToken);

  const response = await fetch("https://auth.truelayer.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return data.access_token;
}

async function autoMatchCreditToInvoice(supabase, transaction: TrueLayerTransaction) {
  const transactionDate = new Date(transaction.date);
  const fiveDaysAgo = new Date(transactionDate);
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  const fiveDaysFuture = new Date(transactionDate);
  fiveDaysFuture.setDate(fiveDaysFuture.getDate() + 5);

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, invoice_number, customers(name), total, due_date, status")
    .eq("status", "sent")
    .or("status.eq.overdue")
    .gte("due_date", fiveDaysAgo.toISOString().split("T")[0])
    .lte("due_date", fiveDaysFuture.toISOString().split("T")[0])
    .order("due_date");

  const matches = invoices?.filter((inv) => {
    const amountDiff = Math.abs(Number(inv.total) - Math.abs(transaction.amount));
    return amountDiff <= 0.01;
  });

  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) {
    return { invoiceId: matches[0].id, status: "matched" };
  }

  return {
    invoiceId: matches[0].id,
    status: "needs_review",
    candidates: matches.map((m) => ({ id: m.id, number: m.invoice_number })),
  };
}

async function autoMatchDebitToExpense(supabase, transaction: TrueLayerTransaction) {
  const transactionDate = new Date(transaction.date);
  const threeDaysAgo = new Date(transactionDate);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const threeDaysFuture = new Date(transactionDate);
  threeDaysFuture.setDate(threeDaysFuture.getDate() + 3);

  const { data: expenses } = await supabase
    .from("expenses")
    .select("id, description, amount, expense_date")
    .gte("expense_date", threeDaysAgo.toISOString().split("T")[0])
    .lte("expense_date", threeDaysFuture.toISOString().split("T")[0])
    .is("matched_expense_id", null);

  const matches = expenses?.filter((exp) => Math.abs(Number(exp.amount) === Math.abs(transaction.amount));

  if (!matches || matches.length === 0) return null;
  return {
    expenseId: matches[0].id,
    candidates: matches.map((m) => ({ id: m.id, description: m.description })),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORSHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { connectionId, userId, daysBack = 90 } = await req.json() as SyncRequest;

    if (!connectionId) {
      return new Response(
        JSON.stringify({ error: "Connection ID required" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: connection } = await supabase
      .from("bank_connections")
      .select("*")
      .eq("id", connectionId)
      .single();

    if (!connection) {
      return new Response(
        JSON.stringify({ error: "Connection not found" }),
        { status: 404, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    let accessToken = connection.access_token;
    const tokenExpires = new Date(connection.token_expires_at);
    if (tokenExpires <= new Date()) {
      accessToken = await refreshTokenIfNeeded(supabase, connection.refresh_token);
      if (!accessToken) {
        return new Response(
          JSON.stringify({ error: "Token refresh failed" }),
          { status: 401, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);
    const fromDateStr = fromDate.toISOString().split("T")[0];

    const transactionsUrl = new URL(TRUELAYER_TRANSACTIONS_URL);
    transactionsUrl.searchParams.set("account_id", connection.truelayer_connection_id);
    transactionsUrl.searchParams.set("from_date", fromDateStr);
    transactionsUrl.searchParams.set("limit", "100");

    const transactionsResponse = await fetch(transactionsUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!transactionsResponse.ok) {
      const err = await transactionsResponse.text();
      console.error("Transactions fetch failed:", err);
      return new Response(
        JSON.stringify({ error: "Failed to fetch transactions" }),
        { status: 400, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
      );
    }

    const transactionsData = (await transactionsResponse.json()) as {
      results: TrueLayerTransaction[];
    };
    const transactions = transactionsData.results || [];

    let inserted = 0;
    let matched = 0;
    const autoMatchResults: Array<{
      transactionId: string;
      status: string;
      invoiceId?: string;
      expenseId?: string;
    }> = [];

    for (const tx of transactions) {
      const { data: existing } = await supabase
        .from("bank_transactions")
        .select("id")
        .eq("truelayer_transaction_id", tx.transaction_id)
        .single();

      if (existing) continue;

      const reconciliationStatus = "unmatched";
      let matchedInvoiceId = null;
      let matchedExpenseId = null;
      let matchStatus = "unmatched";

      if (tx.transaction_type === "Credit" || tx.amount > 0) {
        const matchResult = await autoMatchCreditToInvoice(supabase, tx);
        if (matchResult) {
          if (matchResult.status === "matched") {
            matchedInvoiceId = matchResult.invoiceId;
            matchStatus = "matched";
          } else {
            matchStatus = "needs_review";
          }
        }
      } else if (tx.transaction_type === "Debit" || tx.amount < 0) {
        const matchResult = await autoMatchDebitToExpense(supabase, tx);
        if (matchResult) {
          matchedExpenseId = matchResult.expenseId;
          matchStatus = "needs_review";
        }
      }

      await supabase.from("bank_transactions").insert({
        connection_id: connectionId,
        truelayer_transaction_id: tx.transaction_id,
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        currency: tx.currency || "GBP",
        transaction_type: tx.amount > 0 ? "credit" : "debit",
        merchant_name: tx.merchant_name,
        category: tx.category,
        reconciliation_status: matchStatus,
        matched_invoice_id: matchedInvoiceId,
        matched_expense_id: matchedExpenseId,
      });

      inserted++;

      if (matchStatus !== "unmatched") {
        matched++;
        autoMatchResults.push({
          transactionId: tx.transaction_id,
          status: matchStatus,
          invoiceId: matchedInvoiceId,
          expenseId: matchedExpenseId,
        });
      }
    }

    await supabase
      .from("bank_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", connectionId);

    return new Response(
      JSON.stringify({
        success: true,
        imported: inserted,
        matched,
        results: autoMatchResults,
      }),
      { headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Sync error:", error);
    return new Response(
      JSON.stringify({ error: "Sync failed" }),
      { status: 500, headers: { ...CORSHeaders, "Content-Type": "application/json" } }
    );
  }
});