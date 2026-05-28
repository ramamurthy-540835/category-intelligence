import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function getBackendUrl() {
  return process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
}

export async function POST(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get('limit') || '100';
  try {
    const res = await fetch(`${getBackendUrl()}/feeds/prices?limit=${encodeURIComponent(limit)}`, { method: 'POST' });
    const text = await res.text();
    return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return NextResponse.json({ error: String(e), backend_url: getBackendUrl() }, { status: 502 });
  }
}

