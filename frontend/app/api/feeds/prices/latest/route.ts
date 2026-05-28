import { NextResponse, NextRequest } from 'next/server';

export const runtime = 'nodejs';

function getBackendUrl() {
  const url = process.env.NEXT_PUBLIC_BACKEND_URL ||
              process.env.BACKEND_URL ||
              process.env.NEXT_PUBLIC_API_BASE_URL ||
              'https://category-intelligence-backend-gygcwrc62a-uc.a.run.app';
  return url;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();
    const backendUrl = getBackendUrl();
    const url = `${backendUrl}/feeds/prices/latest${queryString ? '?' + queryString : ''}`;
    console.log(`[feeds/prices/latest] Fetching: ${url}`);

    const res = await fetch(url, { cache: 'no-store' });
    console.log(`[feeds/prices/latest] Response status: ${res.status}`);

    if (!res.ok) {
      console.error(`[feeds/prices/latest] Backend returned ${res.status}`);
      return NextResponse.json([], { status: 200 });
    }
    const text = await res.text();
    console.log(`[feeds/prices/latest] Response length: ${text.length} bytes`);
    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error(`[feeds/prices/latest] Error: ${e?.message}`);
    return NextResponse.json([], { status: 200 });
  }
}
