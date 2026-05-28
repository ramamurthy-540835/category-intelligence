import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const ALLOWED_TABS = new Set(['overview', 'inventory', 'dc-stock', 'promos', 'competitive', 'vendor']);

function getBackendUrl() {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    'https://category-intelligence-backend-gygcwrc62a-uc.a.run.app'
  );
}

export async function GET(req: NextRequest, { params }: { params: { tab: string } }) {
  const tab = params.tab;

  if (!ALLOWED_TABS.has(tab)) {
    return NextResponse.json({ error: 'Tab not found' }, { status: 404 });
  }

  try {
    const params = new URLSearchParams(req.nextUrl.searchParams);
    const url = `${getBackendUrl()}/dashboard/${tab}?${params.toString()}`;

    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Backend error', status: response.status },
        { status: response.status }
      );
    }

    const text = await response.text();
    return new NextResponse(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
}
