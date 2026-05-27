import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function getBackendUrl() {
  return process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://10.100.15.44:8005';
}

export async function GET() {
  try {
    const res = await fetch(`${getBackendUrl()}/feeds/prices/latest`, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json([], { status: 200 });
    }
    const text = await res.text();
    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return NextResponse.json([], { status: 200 });
  }
}
