/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { WorksGrid } from './components/WorksGrid';
import { Pricing } from './components/Pricing';
import { ServerStatus } from './components/ServerStatus';

export default function App() {
  return (
    <div className="h-screen w-full overflow-y-auto overflow-x-hidden snap-y snap-mandatory scroll-smooth selection:bg-primary/30 selection:text-white text-white no-scrollbar relative">
      
      {/* Global Background */}
      <div className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden bg-[#050505]">
        {/* Grid */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-100" />
        
        {/* Animated Light Orbs */}
        <div className="absolute top-[20%] left-[20%] w-[40vw] h-[40vw] bg-primary/5 rounded-full blur-[150px] mix-blend-screen animate-[pulse_10s_ease-in-out_infinite]" />
        <div className="absolute bottom-[10%] right-[10%] w-[30vw] h-[30vw] bg-secondary/5 rounded-full blur-[150px] mix-blend-screen animate-[pulse_12s_ease-in-out_infinite_reverse]" />
      </div>

      <Header />
      <Hero />
      <WorksGrid />
      <Pricing />
      <ServerStatus />
    </div>
  );
}
