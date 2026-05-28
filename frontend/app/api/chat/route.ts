import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function getBackendUrl() {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.message || !body.session_id) {
      return NextResponse.json({ error: 'Missing message or session_id' }, { status: 400 });
    }

    const response = await fetch(`${getBackendUrl()}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: body.message,
        session_id: body.session_id,
        user_id: req.headers.get('x-user-identity') || 'anonymous',
        user_role: req.headers.get('x-user-role') || 'viewer'
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: 'Backend error', detail: text }, { status: 502 });
    }

    return new NextResponse(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      }
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

