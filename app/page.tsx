import { ChatInterface } from "@/components/chat/ChatInterface";
import AgentControlCenter from "@/components/chat/AgentControlCenter";
import AlertTicker from "@/components/AlertTicker";

const DEMO_ALERTS = [
  { priority: 'P1', sku: 'Sony X90L 75"', msg: 'Stockout in 9 days · Tier A' },
  { priority: 'P1', sku: 'Samsung QN85C 65"', msg: 'Price 7.7% above Amazon' },
  { priority: 'P2', sku: 'LG C3 OLED 55"', msg: '31% below forecast · 580 units overstock' },
  { priority: 'P2', sku: 'Hisense U8K', msg: '3K co-op expiring Dec 31 · 43% consumed' },
];

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-gray-950">
      <header className="bg-blue-900 px-6 py-3 flex items-center gap-4">
        <span className="font-bold text-yellow-400 text-lg">BBY</span>
        <span className="font-semibold text-white">Category Intelligence</span>
        <span className="text-xs text-blue-300 ml-1">POWERED BY ADEPT AI</span>
      </header>
      <AlertTicker alerts={DEMO_ALERTS} />
      <div className="flex flex-1 p-4 gap-4">
        <div className="w-[35%] flex flex-col h-full overflow-y-auto">
          <AgentControlCenter alerts={DEMO_ALERTS} />
        </div>
        <div className="w-[65%] flex flex-1 h-full overflow-y-auto">
          <ChatInterface />
        </div>
      </div>
    </main>
  );
}
