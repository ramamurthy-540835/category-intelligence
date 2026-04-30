"use client";

import { useEffect, useState } from "react";
import { ChatInterface } from "@/components/chat/ChatInterface";
import AgentControlCenter from "@/components/chat/AgentControlCenter";
import AlertTicker from "@/components/AlertTicker";

type Alert = { priority: "P1" | "P2"; sku: string; msg: string };

export default function Home() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/dashboard/overview", { cache: "no-store" });
        const data = await res.json();
        setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
      } catch {
        setAlerts([]);
      }
    };

    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="flex min-h-screen flex-col bg-gray-950">
      <header className="bg-blue-900 px-6 py-3 flex items-center gap-4">
        <span className="font-bold text-yellow-400 text-lg">BBY</span>
        <span className="font-semibold text-white">Category Intelligence</span>
        <span className="text-xs text-blue-300 ml-1">POWERED BY ADEPT AI</span>
      </header>
      <AlertTicker alerts={alerts} />
      <div className="flex flex-1 p-4 gap-4">
        <div className="w-[35%] flex flex-col h-full overflow-y-auto">
          <AgentControlCenter alerts={alerts} />
        </div>
        <div className="w-[65%] flex flex-1 h-full overflow-y-auto">
          <ChatInterface />
        </div>
      </div>
    </main>
  );
}
