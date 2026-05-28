import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function getBackendUrl() {
  return process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
}

export async function GET(req: NextRequest) {
  try {
    const backendUrl = getBackendUrl();
    const qs = req.nextUrl.searchParams.toString();
    const response = await fetch(`${backendUrl}/dashboard/sell-through${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
    if (!response.ok) {
      return NextResponse.json({ rows: [], source: 'fallback', error: `Backend unavailable (${response.status})` }, { status: 200 });
    }
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ rows: [], source: 'fallback', error: String(error) }, { status: 200 });
  }
}
