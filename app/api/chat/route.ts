import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.message || !body.session_id) {
      return NextResponse.json({ error: 'Missing message or session_id' }, { status: 400 });
    }

    const userId = req.headers.get('x-user-identity') || 'anonymous';
    const userRole = req.headers.get('x-user-role') || 'viewer';

    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const response = await fetch(`${backendUrl}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: body.message,
        session_id: body.session_id,
        user_id: userId,
        user_role: userRole
      })
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Backend error' }, { status: 502 });
    }

    return new NextResponse(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
