import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function getBackendUrl() {
  return process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
}

export async function GET() {
  try {
    const res = await fetch(`${getBackendUrl()}/agent/status`, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({
        status: 'idle',
        backend_status: res.status,
        warning: 'Backend unavailable; running in UI-only mode.',
      }, { status: 200 });
    }
    const text = await res.text();
    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return NextResponse.json({
      status: 'paused',
      warning: 'Backend unavailable; sync paused.',
      error: String(e),
      backend_url: getBackendUrl(),
      active_run: null,
      events: [],
    }, { status: 200 });
  }
}
