export async function onRequest({ request, env }) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors });
  }

  try {
    let data = {};

    if (request.method === "POST") {
      const type = request.headers.get("content-type") || "";
      if (type.includes("application/json")) {
        data = await request.json();
      } else {
        const text = await request.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = Object.fromEntries(new URLSearchParams(text));
        }
      }
    } else if (request.method === "GET") {
      data = Object.fromEntries(new URL(request.url).searchParams);
    } else {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { "content-type": "application/json", ...cors }
      });
    }

    const telegramId = String(data.telegram_id || "").trim();
    const widgetId = String(data.widget_id || "").trim();

    if (!telegramId || !widgetId) {
      return new Response(JSON.stringify({ ok: false, error: "Missing telegram_id or widget_id" }), {
        status: 400,
        headers: { "content-type": "application/json", ...cors }
      });
    }

    const eventType = "click";
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS tads_ad_events (id INTEGER PRIMARY KEY AUTOINCREMENT,telegram_id TEXT NOT NULL,widget_id TEXT NOT NULL,event_type TEXT NOT NULL,method TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    ).run();

    await env.DB.prepare(
      "INSERT INTO tads_ad_events (telegram_id,widget_id,event_type,method) VALUES (?,?,?,?)"
    ).bind(telegramId, widgetId, eventType, request.method).run();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", ...cors }
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: "Webhook processing failed" }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors }
    });
  }
}