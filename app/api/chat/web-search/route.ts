// app/api/web-search/route.ts

import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"

import { supabaseServiceRole } from "@/lib/supabase/service-role"

export const runtime = "edge"

// env vars
const DF_LOGIN = process.env.NEXT_PUBLIC_DATAFORSEO_LOGIN!
const DF_PASSWORD = process.env.NEXT_PUBLIC_DATAFORSEO_PASSWORD!
const AZURE_KEY = process.env.AZURE_OPENAI_KEY!
const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT!
const AZURE_DEPLOYMENT = process.env.AZURE_GPT_45_TURBO_NAME!

async function checkConnection(): Promise<boolean> {
  const auth = Buffer.from(`${DF_LOGIN}:${DF_PASSWORD}`).toString("base64")
  try {
    const res = await fetch("https://api.dataforseo.com/v3/appendix/status", {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json"
      }
    })
    return res.ok
  } catch {
    return false
  }
}

async function fetchSearchResults(query: string) {
  const auth = Buffer.from(`${DF_LOGIN}:${DF_PASSWORD}`).toString("base64")
  const body = [
    { language_code: "en", location_name: "United States", keyword: query }
  ]

  const res = await fetch(
    "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`DataForSEO error ${res.status}: ${text}`)
  }
  return res.json()
}

export async function POST(req: NextRequest) {
  // 1) check network
  if (!(await checkConnection())) {
    return NextResponse.json(
      {
        error: "🚫 I'm not connected to the internet. Please try again later."
      },
      { status: 503 }
    )
  }

  // 2) parse body
  const { query, chatSettings, messages } = await req.json()
  if (!query) {
    return NextResponse.json(
      { error: "Missing `query` in request body" },
      { status: 400 }
    )
  }

  try {
    // 3) fetch the SERP
    const df = await fetchSearchResults(query)
    const items = (df.tasks?.[0]?.result?.[0]?.items as any[]) || []

    // 4) normalize
    const search_results = items.map(i => ({
      type: i.type,
      title: i.title,
      link: i.url,
      snippet: i.description,
      image: i.images?.[0]?.url,
      date: i.timestamp?.split(" ")[0],
      channel: i.website_name
    }))

    // 5) build OpenAI client
    const client = new OpenAI({
      apiKey: AZURE_KEY,
      baseURL: `${AZURE_ENDPOINT}/openai/deployments/${AZURE_DEPLOYMENT}`,
      defaultHeaders: { "api-key": AZURE_KEY },
      defaultQuery: { "api-version": "2023-12-01-preview" }
    })

    // 6) map incoming history into {role,content}
    const history = Array.isArray(messages)
      ? messages
        .map((m: any) => {
          // unwrap .message if present
          const msg = m.message ?? m
          return msg.role && msg.content
            ? {
              role: msg.role as "user" | "assistant" | "system",
              content: msg.content
            }
            : null
        })
        .filter((m: any): m is { role: string; content: string } => !!m)
      : []

    // 7) assemble the chat‑completion messages
    const systemMsg = {
      role: "system" as const,
      content: `You are ChatGPT, a helpful assistant. You have access to up-to-date web search results below. Use them to answer the user's question fully—choose whatever structure best fits the topic. Cite sources by number when relevant.`
    }
    const toolMsg = {
      role: "assistant" as const,
      name: "web_search_tool",
      content: JSON.stringify(search_results, null, 2)
    }
    const userMsg = {
      role: "user" as const,
      content: `User asked: "${query}". Use the search results above to craft your reply.`
    }

    // 8) call Azure OpenAI
    const resp = await client.chat.completions.create({
      model: AZURE_DEPLOYMENT,
      temperature: chatSettings?.temperature ?? 0,
      max_tokens: 1200,
      messages: [systemMsg, toolMsg, userMsg, ...history].filter(
        (m): m is Exclude<typeof m, null> => m !== null
      )
    })

    // --- Server-side persistence of user and assistant messages ---
    // 1. Find chat_id, user_id, assistant_id, and sequence_number from messages/history
    let chat_id = null,
      user_id = null,
      assistant_id = null
    let lastSeq = 0
    if (Array.isArray(messages) && messages.length > 0) {
      // Try to get from last user message
      const lastUserMsg =
        messages[messages.length - 1].message || messages[messages.length - 1]
      chat_id = lastUserMsg.chat_id || null
      user_id = lastUserMsg.user_id || null
      assistant_id = lastUserMsg.assistant_id || null
      lastSeq =
        typeof lastUserMsg.sequence_number === "number"
          ? lastUserMsg.sequence_number
          : messages.length - 1
    }

    // Log what will be inserted
    console.log("[WebSearch API] Persisting user message:", {
      chat_id,
      user_id,
      assistant_id,
      lastSeq,
      query,
      model: chatSettings?.model || AZURE_DEPLOYMENT
    })

    // 2. Persist user message (if not already in DB)
    if (chat_id && user_id && query) {
      const { error: userInsertError, data: userInsertData } =
        await supabaseServiceRole.from("messages").insert([
          {
            chat_id,
            user_id,
            assistant_id,
            role: "user",
            content: query,
            model: chatSettings?.model || AZURE_DEPLOYMENT,
            sequence_number: lastSeq + 1,
            image_paths: []
          }
        ])
      if (userInsertError) {
        console.error(
          "[WebSearch API] User message insert error:",
          userInsertError
        )
      } else {
        console.log(
          "[WebSearch API] User message insert success:",
          userInsertData
        )
      }
    }

    // 3. Persist assistant message
    const assistantContent = resp.choices[0]?.message?.content ?? ""
    if (chat_id && user_id && assistantContent) {
      const { error: assistantInsertError, data: assistantInsertData } =
        await supabaseServiceRole.from("messages").insert([
          {
            chat_id,
            user_id,
            assistant_id,
            role: "assistant",
            content: assistantContent,
            model: chatSettings?.model || AZURE_DEPLOYMENT,
            sequence_number: lastSeq + 2,
            image_paths: []
          }
        ])
      if (assistantInsertError) {
        console.error(
          "[WebSearch API] Assistant message insert error:",
          assistantInsertError
        )
      } else {
        console.log(
          "[WebSearch API] Assistant message insert success:",
          assistantInsertData
        )
      }
    }

    return NextResponse.json({ message: assistantContent }, { status: 200 })
  } catch (err: any) {
    console.error("web-search error:", err)
    return NextResponse.json(
      { error: err.message || "Unexpected server error" },
      { status: 500 }
    )
  }
}
