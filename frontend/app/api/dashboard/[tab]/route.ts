import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const ALLOWED_TABS = new Set(['overview', 'inventory', 'dc-stock', 'promos', 'competitive', 'vendor']);

function getBackendUrl() {
  return (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    'http://10.100.15.44:8005'
  );
}

export async function GET(req: NextRequest, { params }: { params: { tab: string } }) {
  const tab = params.tab;

  if (!ALLOWED_TABS.has(tab)) {
    return NextResponse.json({ error: 'Tab not found' }, { status: 404 });
  }

  try {
    const backendUrl = getBackendUrl();
    const qs = req.nextUrl.searchParams.toString();
    const response = await fetch(`${backendUrl}/dashboard/${tab}${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json({
        tab,
        source: 'fallback',
        alerts: [],
        rows: [],
        data: [],
        error: `Backend unavailable (${response.status})`,
        detail,
        backend_url: backendUrl,
      }, { status: 200 });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({
      tab,
      source: 'fallback',
      alerts: [],
      data: [],
      error: String(error),
      backend_url: getBackendUrl(),
    }, { status: 200 });
  }
}
