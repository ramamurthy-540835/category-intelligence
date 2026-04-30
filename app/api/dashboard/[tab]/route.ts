import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const ALLOWED_TABS = new Set(['overview', 'inventory', 'dc-stock', 'promos', 'competitive', 'vendor']);

export async function GET(req: NextRequest, { params }: { params: { tab: string } }) {
  const tab = params.tab;
  
  if (!ALLOWED_TABS.has(tab)) {
    return NextResponse.json({ error: 'Tab not found' }, { status: 404 });
  }

  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const response = await fetch(`${backendUrl}/dashboard/${tab}`);
    
    if (!response.ok) {
      throw new Error('Backend fetch failed');
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ source: 'fallback', tab, data: [] });
  }
}
