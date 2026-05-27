import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function getBackendUrl() {
  return process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://10.100.15.44:8005';
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
      status: 'ok',
      warning: 'Backend unavailable; running in connected demo mode.',
      error: String(e),
      backend_url: getBackendUrl(),
      active_run: { run_id: 'demo-run', status: 'RUNNING' },
      events: [
        { run_id: 'demo-run', timestamp: new Date().toISOString(), stage: 'RESPONDING', status: 'RUNNING', message: 'Dashboard connected in demo mode.' },
        { run_id: 'demo-run', timestamp: new Date(Date.now() - 60000).toISOString(), stage: 'ANALYZING', status: 'SUCCESS', message: 'Flow metrics and chart datasets loaded.' },
        { run_id: 'demo-run', timestamp: new Date(Date.now() - 120000).toISOString(), stage: 'PROCESSING', status: 'SUCCESS', message: 'Workspace and right panel synchronized.' },
      ],
    }, { status: 200 });
  }
}
