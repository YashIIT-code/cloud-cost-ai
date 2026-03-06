import { useState, useEffect, useRef, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from "recharts";

/* ─── TOKENS ────────────────────────────────────────────────────────────────── */
const T = {
  bg:"#050810", surface:"#080c14", card:"#0c1220", subtle:"#0f1928",
  border:"#131d2e", borderHi:"#1e3050",
  cyan:"#00f5d4",   cyanDim:"rgba(0,245,212,0.08)",
  blue:"#3b82f6",   blueDim:"rgba(59,130,246,0.10)",
  amber:"#f59e0b",  amberDim:"rgba(245,158,11,0.10)",
  red:"#ef4444",    redDim:"rgba(239,68,68,0.10)",
  green:"#10b981",  greenDim:"rgba(16,185,129,0.10)",
  purple:"#8b5cf6", purpleDim:"rgba(139,92,246,0.10)",
  text:"#e2e8f0",   muted:"#4a6080",
  mono:"'JetBrains Mono','Fira Code',monospace",
  display:"'Plus Jakarta Sans',sans-serif",
};

/* ─── SAMPLE DATA ───────────────────────────────────────────────────────────── */
const SAMPLE = `resource_id,provider,type,region,cpu_avg,mem_avg,storage_gb,monthly_cost,hours_idle,tags
vm-prod-api-01,AWS,t3.xlarge,us-east-1,7,11,200,312,528,production
vm-prod-db-02,AWS,r5.2xlarge,us-east-2,68,79,2000,892,18,production
vm-dev-03,GCP,n1-standard-2,us-central1,3,4,50,142,685,development
vm-stage-04,Azure,Standard_D4s_v3,eastus,11,17,100,198,432,staging
vm-analytics-05,AWS,m5.4xlarge,ap-southeast-1,4,5,900,1240,704,analytics
vm-ml-06,AWS,p3.2xlarge,us-east-1,8,13,500,2184,641,ml
vm-cache-07,GCP,n2-standard-4,europe-west1,44,70,100,248,182,production
vm-batch-08,Azure,Standard_F8s_v2,westus2,5,9,150,448,602,batch
vm-api-09,AWS,t3.medium,us-west-2,91,85,80,92,4,production
vm-report-10,GCP,n1-highmem-4,asia-east1,6,8,300,364,618,reporting`;

const PC = { AWS:T.amber, GCP:T.blue, Azure:T.cyan };
const PI = { AWS:"☁", GCP:"◈", Azure:"◻" };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ─── PARSE ─────────────────────────────────────────────────────────────────── */
function parseCSV(txt) {
  const lines = txt.trim().split("\n");
  const hdr = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(ln => {
    const v = ln.split(",").map(s => s.trim());
    const o = {};
    hdr.forEach((h, i) => { o[h] = isNaN(v[i]) || v[i] === "" ? v[i] : +v[i]; });
    return o;
  });
}

/* ─── ML ANALYSIS ENGINE ────────────────────────────────────────────────────── */
function analyze(resources) {
  return resources.map(r => {
    const idleRatio = r.hours_idle / 720;
    const isIdle    = idleRatio > 0.6;
    const isOver    = r.cpu_avg < 15 && r.mem_avg < 20;
    const isBigStore= r.storage_gb > 400;
    const noScale   = r.cpu_avg < 20 && r.monthly_cost > 300;

    let score = 0;
    if (isIdle)     score += 4;
    if (isOver)     score += 3;
    if (isBigStore) score += 1;
    if (noScale)    score += 2;
    const risk = score >= 5 ? "High" : score >= 3 ? "Medium" : "Low";

    let savings = 0;
    const actions = [];
    const cliCmds = [];
    const terraformFix = [];

    if (isIdle) {
      savings += r.monthly_cost * 0.9;
      actions.push({ icon:"🛑", text:"Terminate or hibernate idle instance", impact:"High" });
      cliCmds.push(`aws ec2 stop-instances --instance-ids ${r.resource_id}`);
      terraformFix.push(`# Stop idle instance\nresource "aws_instance" "${r.resource_id.replace(/-/g,"_")}" {\n  instance_state = "stopped"\n}`);
    } else if (isOver) {
      savings += r.monthly_cost * 0.45;
      actions.push({ icon:"📦", text:"Downsize to next smaller instance type", impact:"High" });
      cliCmds.push(`aws ec2 modify-instance-attribute --instance-id ${r.resource_id} --instance-type t3.small`);
      terraformFix.push(`# Downsize instance\nresource "aws_instance" "${r.resource_id.replace(/-/g,"_")}" {\n  instance_type = "t3.small"\n}`);
    }
    if (isBigStore) {
      savings += (r.storage_gb - 200) * 0.023;
      actions.push({ icon:"🗄", text:"Archive cold data to Glacier / Coldline", impact:"Medium" });
      cliCmds.push(`aws s3api put-bucket-lifecycle-configuration --bucket ${r.resource_id}-data --lifecycle-configuration file://lifecycle.json`);
      terraformFix.push(`# Add lifecycle rule\nresource "aws_s3_bucket_lifecycle_configuration" "${r.resource_id.replace(/-/g,"_")}_lifecycle" {\n  rule { transition { days = 30; storage_class = "GLACIER" } }\n}`);
    }
    if (noScale) {
      savings += r.monthly_cost * 0.3;
      actions.push({ icon:"⚡", text:"Configure autoscaling group (min:1, max:4)", impact:"Medium" });
      cliCmds.push(`aws autoscaling create-auto-scaling-group --auto-scaling-group-name ${r.resource_id}-asg --min-size 1 --max-size 4`);
      terraformFix.push(`# Add autoscaling\nresource "aws_autoscaling_group" "${r.resource_id.replace(/-/g,"_")}_asg" {\n  min_size = 1\n  max_size = 4\n  desired_capacity = 2\n}`);
    }
    if (actions.length === 0) {
      actions.push({ icon:"✅", text:"Well-optimized — schedule monthly review", impact:"Low" });
    }

    const co2 = Math.round((r.hours_idle / 720) * Math.max(savings, 1) * 0.015 * 10) / 10;

    return { ...r, risk, score, savings:Math.round(savings), actions, cliCmds, terraformFix, co2, isIdle, isOver, isBigStore, noScale };
  });
}

function buildForecast(analyzed) {
  const total = analyzed.reduce((s, r) => s + r.monthly_cost, 0);
  const m = new Date().getMonth();
  // use a seeded-ish variation so it doesn't change on re-render
  return Array.from({ length: 7 }, (_, i) => {
    const growth    = 1 + i * 0.028 + (i % 3 === 0 ? 0.01 : -0.005);
    const projected = Math.round(total * growth);
    const optimized = Math.round(Math.max(total * growth * (1 - 0.06 * i), total * 0.38));
    return { month: MONTHS[(m + i) % 12], projected, optimized, saved: projected - optimized };
  });
}

/* ─── SMALL UI ATOMS ────────────────────────────────────────────────────────── */
const RiskPill = ({ level }) => {
  const s = { High:{c:T.red,bg:T.redDim}, Medium:{c:T.amber,bg:T.amberDim}, Low:{c:T.green,bg:T.greenDim} }[level];
  return (
    <span style={{ background:s.bg, color:s.c, border:`1px solid ${s.c}30`,
      padding:"2px 10px", borderRadius:20, fontSize:10, fontWeight:800,
      letterSpacing:"0.1em", fontFamily:T.mono, textTransform:"uppercase",
      boxShadow:`0 0 8px ${s.c}25` }}>{level}</span>
  );
};

const Tag = ({ color, children }) => (
  <span style={{ background:`${color}15`, color, border:`1px solid ${color}30`,
    padding:"2px 8px", borderRadius:6, fontSize:9, fontWeight:800,
    fontFamily:T.mono, letterSpacing:"0.08em" }}>{children}</span>
);

function KpiCard({ label, value, sub, color, icon, delay=0 }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(()=>setOn(true), delay); return ()=>clearTimeout(t); }, [delay]);
  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`,
      borderTop:`2px solid ${color}`, borderRadius:16, padding:"20px 22px",
      flex:1, minWidth:150, position:"relative", overflow:"hidden",
      opacity:on?1:0, transform:on?"translateY(0)":"translateY(14px)",
      transition:"opacity .5s ease, transform .5s cubic-bezier(.34,1.56,.64,1)",
      cursor:"default" }}
      onMouseEnter={e=>{ e.currentTarget.style.boxShadow=`0 0 28px ${color}18`; }}
      onMouseLeave={e=>{ e.currentTarget.style.boxShadow="none"; }}>
      <div style={{ position:"absolute",top:-20,right:-20,width:80,height:80,borderRadius:"50%",
        background:`radial-gradient(circle,${color}18,transparent 70%)` }}/>
      <div style={{ fontSize:22, marginBottom:8 }}>{icon}</div>
      <div style={{ fontSize:28, fontWeight:900, color, fontFamily:T.mono, lineHeight:1, letterSpacing:"-0.02em" }}>{value}</div>
      <div style={{ fontSize:11, color:T.muted, marginTop:8, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</div>
      {sub && <div style={{ fontSize:11, color:color+"99", marginTop:3 }}>{sub}</div>}
    </div>
  );
}

const TT = { background:T.card, border:`1px solid ${T.borderHi}`, borderRadius:10, fontSize:12, color:T.text };

/* ─── ANOMALY TICKER ────────────────────────────────────────────────────────── */
function AnomalyTicker({ items }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!items.length) return;
    const t = setInterval(() => setIdx(i => (i+1) % items.length), 3200);
    return () => clearInterval(t);
  }, [items.length]);
  if (!items.length) return null;
  const it = items[idx];
  return (
    <div style={{ background:T.redDim, border:`1px solid ${T.red}30`, borderRadius:8,
      padding:"7px 14px", display:"flex", alignItems:"center", gap:10, fontSize:12 }}>
      <div style={{ width:6, height:6, borderRadius:"50%", background:T.red, flexShrink:0,
        animation:"blink 1s ease-in-out infinite" }}/>
      <span style={{ color:T.red, fontWeight:800, fontFamily:T.mono, flexShrink:0 }}>ANOMALY</span>
      <span style={{ color:T.muted }}>·</span>
      <span style={{ color:T.text }}>{it.id}</span>
      <span style={{ color:T.muted }}>→</span>
      <span style={{ color:T.amber, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{it.issue}</span>
      <span style={{ marginLeft:"auto", color:T.muted, fontFamily:T.mono, fontSize:11, flexShrink:0 }}>{idx+1}/{items.length}</span>
    </div>
  );
}

/* ─── SCAN SCREEN ───────────────────────────────────────────────────────────── */
const SCAN_STEPS = [
  "Connecting to cloud provider APIs…",
  "Ingesting resource metadata…",
  "Running utilization analysis…",
  "Detecting idle & overprovisioned VMs…",
  "Analysing storage access patterns…",
  "Computing cost optimization model…",
  "Generating architecture risk scores…",
  "Calculating CO₂ savings potential…",
  "Building 6-month forecast model…",
  "Generating remediation scripts…",
];

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [phase,    setPhase]    = useState("upload");
  const [scanPct,  setScanPct]  = useState(0);
  const [scanMsg,  setScanMsg]  = useState("");
  const [tab,      setTab]      = useState("overview");
  const [analyzed, setAnalyzed] = useState([]);
  const [forecast, setForecast] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [cliOpen,  setCliOpen]  = useState(null);  // resource index
  const [tfOpen,   setTfOpen]   = useState(null);
  const [chat,     setChat]     = useState([
    { role:"ai", text:"👋 I'm **ARIA** — your AI Resource Intelligence Advisor. Upload your cloud data, then ask me anything about costs, waste, risks, and optimization strategy." }
  ]);
  const [chatIn,   setChatIn]   = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [copied,   setCopied]   = useState(null);

  const fileRef = useRef(null);
  const chatEnd = useRef(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior:"smooth" }); }, [chat]);

  /* ── scan animation ── */
  const runScan = useCallback((raw) => {
    setPhase("scanning");
    let i = 0;
    const step = () => {
      setScanMsg(SCAN_STEPS[i]);
      setScanPct(Math.round(((i+1)/SCAN_STEPS.length)*100));
      i++;
      if (i < SCAN_STEPS.length) setTimeout(step, 260);
      else setTimeout(() => {
        const a = analyze(raw);
        setAnalyzed(a);
        setForecast(buildForecast(a));
        setPhase("ready");
      }, 350);
    };
    setTimeout(step, 150);
  }, []);

  const loadFile = useCallback((txt, isJson) => {
    try { runScan(isJson ? JSON.parse(txt) : parseCSV(txt)); }
    catch(e) { alert("Parse error: " + e.message); }
  }, [runScan]);

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => loadFile(ev.target.result, f.name.endsWith(".json"));
    r.readAsText(f);
  };
  const handlePick = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => loadFile(ev.target.result, f.name.endsWith(".json"));
    r.readAsText(f);
  };

  /* ── derived stats ── */
  const totalCost    = analyzed.reduce((s,r)=>s+r.monthly_cost,0);
  const totalSavings = analyzed.reduce((s,r)=>s+r.savings,0);
  const totalCO2     = analyzed.reduce((s,r)=>s+r.co2,0);
  const idleCount    = analyzed.filter(r=>r.isIdle).length;
  const highRisk     = analyzed.filter(r=>r.risk==="High").length;
  const savingsPct   = totalCost>0 ? Math.round(totalSavings/totalCost*100) : 0;

  const efficiencyScore = Math.max(0, Math.floor(100 - (idleCount * 5 + highRisk * 7)));
  const efficiencyColor = efficiencyScore >= 80 ? T.green : efficiencyScore >= 60 ? T.amber : T.red;

  const topWaste = [...analyzed].sort((a, b) => b.savings - a.savings).slice(0, 3);
  
  const regionData = Object.values(analyzed.reduce((acc, r) => {
    if (!acc[r.region]) acc[r.region] = { region: r.region, cost: 0, waste: 0 };
    acc[r.region].cost += r.monthly_cost;
    acc[r.region].waste += r.savings;
    return acc;
  }, {})).sort((a, b) => b.waste - a.waste);

  const [aiPlan, setAiPlan] = useState(null);
  
  const generatePDF = () => {
    const importJsPDF = async () => {
      if (!window.jspdf) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        document.body.appendChild(script);
        await new Promise(r => script.onload = r);
      }
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF();
      pdf.setFontSize(20);
      pdf.text("Cloud Optimization Report", 20, 20);
      pdf.setFontSize(12);
      pdf.text(`Total Cloud Cost: $${totalCost.toLocaleString()}`, 20, 40);
      pdf.text(`Potential Savings: $${totalSavings.toLocaleString()}`, 20, 50);
      pdf.text(`Idle Resources: ${idleCount}`, 20, 60);
      pdf.text(`High Risk Resources: ${highRisk}`, 20, 70);
      
      pdf.setFontSize(14);
      pdf.text("Top Waste Resources:", 20, 90);
      pdf.setFontSize(12);
      topWaste.forEach((w, i) => {
        pdf.text(`${w.resource_id} - $${w.savings} waste`, 20, 100 + (i * 10));
      });
      
      pdf.setFontSize(14);
      pdf.text("6-Month Forecast Summary:", 20, 140);
      pdf.setFontSize(12);
      pdf.text("See dashboard for detailed month-by-month breakdown.", 20, 150);

      pdf.setFontSize(14);
      pdf.text("Recommended Optimization Actions:", 20, 170);
      pdf.setFontSize(12);
      pdf.text("1. Terminate idle instances", 20, 180);
      pdf.text("2. Downsize overprovisioned VMs", 20, 190);
      pdf.text("3. Archive cold storage", 20, 200);

      pdf.save("optimization-report.pdf");
    };
    importJsPDF();
  };

  const generatePlan = () => {
    setAiPlan([
      { week: "Week 1", action: "Terminate idle instances" },
      { week: "Week 2", action: "Downsize overprovisioned VMs" },
      { week: "Week 3", action: "Archive cold storage" },
      { week: "Week 4", action: "Enable autoscaling and monitoring" }
    ]);
  };

  const anomalies = analyzed
    .filter(r=>r.risk!=="Low")
    .map(r=>({
      id: r.resource_id,
      issue: r.isIdle ? `Idle ${r.hours_idle}h/mo — $${r.savings}/mo waste`
           : r.isOver ? `Overprovisioned (CPU ${r.cpu_avg}%, Mem ${r.mem_avg}%)`
           : `High storage (${r.storage_gb} GB)`,
    }));

  const providerStats = ["AWS","GCP","Azure"].map(p=>({
    name:p,
    count: analyzed.filter(r=>r.provider===p).length,
    cost:  analyzed.filter(r=>r.provider===p).reduce((s,r)=>s+r.monthly_cost,0),
    savings: analyzed.filter(r=>r.provider===p).reduce((s,r)=>s+r.savings,0),
  })).filter(p=>p.count>0);

  const riskDist = [
    { name:"High",   value:analyzed.filter(r=>r.risk==="High").length,   fill:T.red },
    { name:"Medium", value:analyzed.filter(r=>r.risk==="Medium").length, fill:T.amber },
    { name:"Low",    value:analyzed.filter(r=>r.risk==="Low").length,    fill:T.green },
  ];

  const radarData = analyzed.length ? [
    { metric:"CPU Util",    value: Math.round(analyzed.reduce((s,r)=>s+r.cpu_avg,0)/analyzed.length) },
    { metric:"Mem Util",    value: Math.round(analyzed.reduce((s,r)=>s+r.mem_avg,0)/analyzed.length) },
    { metric:"Availability",value: Math.round((1-idleCount/analyzed.length)*100) },
    { metric:"Cost Eff.",   value: Math.round((1-totalSavings/totalCost)*100) },
    { metric:"Low-Risk %",  value: Math.round(analyzed.filter(r=>r.risk==="Low").length/analyzed.length*100) },
  ] : [];

  /* ── copy helper ── */
  const copyText = (txt, key) => {
    navigator.clipboard.writeText(txt).then(() => {
      setCopied(key);
      setTimeout(()=>setCopied(null), 1800);
    });
  };

  /* ── AI chat ── */
  const sendChat = async () => {
    if (!chatIn.trim() || chatBusy) return;
    const msg = chatIn.trim(); setChatIn("");
    setChat(c=>[...c,{role:"user",text:msg}]);
    setChatBusy(true);
    const ctx = analyzed.length
      ? `Fleet: ${analyzed.length} VMs · $${totalCost}/mo · $${totalSavings} savings · ${idleCount} idle · ${highRisk} high-risk · ${totalCO2}kg CO₂\nResources: ${JSON.stringify(analyzed.map(r=>({id:r.resource_id,provider:r.provider,type:r.type,region:r.region,cpu:r.cpu_avg,mem:r.mem_avg,storage:r.storage_gb,cost:r.monthly_cost,risk:r.risk,savings:r.savings,co2:r.co2,actions:r.actions.map(a=>a.text)})))}`
      : "No data uploaded yet.";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, context: ctx })
      });
      
      let d;
      const textResponse = await res.text();
      try {
        d = JSON.parse(textResponse);
      } catch (parseErr) {
        throw new Error(`API returned non-JSON: ${res.status} ${textResponse.substring(0, 50)}...`);
      }

      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      const reply = d.reply || "Sorry, couldn't process that.";
      setChat(c=>[...c,{role:"ai",text:reply}]);
    } catch (err) {
      console.error("Chat error:", err);
      setChat(c=>[...c,{role:"ai",text:`Error: ${err.message}. Are you running with 'vercel dev' and is the OPENAI_API_KEY set?`}]);
    }
    setChatBusy(false);
  };

  /* ════════════════════════════════════════════════════════
     UPLOAD SCREEN
  ════════════════════════════════════════════════════════ */
  if (phase==="upload") return (
    <Shell>
      {/* grid bg */}
      <div style={{ position:"fixed",inset:0,pointerEvents:"none",
        backgroundImage:`linear-gradient(${T.border} 1px,transparent 1px),linear-gradient(90deg,${T.border} 1px,transparent 1px)`,
        backgroundSize:"44px 44px",opacity:0.35 }}/>
      {/* glow orbs */}
      <Orb style={{ top:"18%",left:"12%",width:380,height:380,background:`radial-gradient(circle,${T.cyan}10,transparent 70%)` }}/>
      <Orb style={{ bottom:"18%",right:"12%",width:300,height:300,background:`radial-gradient(circle,${T.purple}10,transparent 70%)` }}/>

      <NavBar>
        <Logo/>
        <span style={{ color:T.muted,fontSize:12,marginLeft:4 }}>Cloud Cost Intelligence Platform</span>
        <div style={{ marginLeft:"auto" }}>
          <Pill color={T.cyan}>v2.1 · HACKATHON EDITION</Pill>
        </div>
      </NavBar>

      <div style={{ flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:40,position:"relative",zIndex:5 }}>
        <div style={{ maxWidth:620,width:"100%" }}>
          <div style={{ textAlign:"center",marginBottom:44 }}>
            <div style={{ display:"inline-flex",alignItems:"center",gap:8,
              background:T.cyanDim,border:`1px solid ${T.cyan}30`,
              padding:"6px 18px",borderRadius:20,marginBottom:24,
              fontSize:11,fontWeight:800,fontFamily:T.mono,color:T.cyan,letterSpacing:"0.1em" }}>
              ◈ AI-POWERED · MULTI-CLOUD · REAL-TIME ANALYSIS
            </div>
            <h1 style={{ fontSize:50,fontWeight:900,letterSpacing:"-0.04em",lineHeight:1.05,
              fontFamily:T.display,marginBottom:16 }}>
              Cut Cloud Costs<br/>
              <span style={{ background:`linear-gradient(135deg,${T.cyan},${T.blue})`,
                WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent" }}>with AI Precision</span>
            </h1>
            <p style={{ color:T.muted,fontSize:15,lineHeight:1.7,maxWidth:460,margin:"0 auto" }}>
              Upload cloud usage data. NimbusIQ's ML engine detects waste, forecasts spend,
              and generates copy-paste remediation scripts instantly.
            </p>
          </div>

          {/* Drop zone */}
          <div
            style={{ border:`2px dashed ${dragOver?T.cyan:T.border}`,borderRadius:20,
              padding:"44px 36px",textAlign:"center",cursor:"pointer",
              background:dragOver?T.cyanDim:T.card,
              boxShadow:dragOver?`0 0 40px ${T.cyan}20`:"none",
              transition:"all .2s",position:"relative" }}
            onClick={()=>fileRef.current?.click()}
            onDragOver={e=>{e.preventDefault();setDragOver(true);}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={handleDrop}>
            <input ref={fileRef} type="file" accept=".csv,.json" style={{display:"none"}} onChange={handlePick}/>
            <div style={{ fontSize:42,marginBottom:14 }}>📂</div>
            <div style={{ fontSize:17,fontWeight:800,marginBottom:6,fontFamily:T.display }}>Drop CSV or JSON here</div>
            <div style={{ fontSize:13,color:T.muted }}>AWS Cost Explorer · GCP Billing · Azure exports</div>
          </div>

          <div style={{ display:"flex",alignItems:"center",gap:14,margin:"18px 0" }}>
            <div style={{ flex:1,height:1,background:T.border }}/>
            <span style={{ color:T.muted,fontSize:12,fontFamily:T.mono }}>OR</span>
            <div style={{ flex:1,height:1,background:T.border }}/>
          </div>

          <button onClick={()=>loadFile(SAMPLE,false)} style={{
            width:"100%",padding:"15px",
            background:`linear-gradient(135deg,${T.cyan}18,${T.blue}18)`,
            border:`1px solid ${T.cyan}40`,borderRadius:14,
            color:T.cyan,fontSize:14,fontWeight:800,cursor:"pointer",
            fontFamily:T.display,transition:"all .2s" }}
            onMouseEnter={e=>e.currentTarget.style.boxShadow=`0 0 28px ${T.cyan}22`}
            onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
            ⚡ Load Demo: 10 Real-World VMs (AWS + GCP + Azure)
          </button>

          <div style={{ display:"flex",flexWrap:"wrap",gap:10,marginTop:28,justifyContent:"center" }}>
            {["🤖 ARIA AI Advisor","📈 6-Month Forecast","🌱 CO₂ Impact",
              "⚙ CLI + Terraform","⚠ Risk Detection","🏛 Multi-Cloud"].map(f=>(
              <span key={f} style={{ background:T.subtle,border:`1px solid ${T.border}`,
                padding:"5px 13px",borderRadius:20,fontSize:12,color:T.muted }}>{f}</span>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );

  /* ════════════════════════════════════════════════════════
     SCANNING SCREEN
  ════════════════════════════════════════════════════════ */
  if (phase==="scanning") return (
    <Shell center>
      <div style={{ position:"fixed",inset:0,
        backgroundImage:`linear-gradient(${T.border} 1px,transparent 1px),linear-gradient(90deg,${T.border} 1px,transparent 1px)`,
        backgroundSize:"44px 44px",opacity:0.3 }}/>
      <Orb style={{ top:"50%",left:"50%",transform:"translate(-50%,-50%)",
        width:500,height:500,background:`radial-gradient(circle,${T.cyan}08,transparent 70%)`,
        animation:"pulse-ring 2.2s ease-in-out infinite" }}/>

      <div style={{ textAlign:"center",position:"relative",zIndex:5 }}>
        <div style={{ width:76,height:76,borderRadius:18,margin:"0 auto 22px",
          background:`linear-gradient(135deg,${T.cyan}30,${T.blue}30)`,
          border:`2px solid ${T.cyan}60`,display:"flex",alignItems:"center",
          justifyContent:"center",fontSize:34,animation:"spin-slow 3s linear infinite" }}>☁</div>
        <h2 style={{ fontSize:26,fontWeight:900,fontFamily:T.display,marginBottom:6,letterSpacing:"-0.02em" }}>
          Analysing Your Infrastructure
        </h2>
        <p style={{ color:T.muted,fontSize:14 }}>ARIA ML engine running…</p>
      </div>

      <div style={{ width:460,position:"relative",zIndex:5,marginTop:32 }}>
        <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:26 }}>
          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:10 }}>
            <span style={{ fontSize:13,color:T.muted,fontFamily:T.mono }}>{scanMsg}</span>
            <span style={{ fontSize:13,fontWeight:800,color:T.cyan,fontFamily:T.mono }}>{scanPct}%</span>
          </div>
          <div style={{ height:6,background:T.border,borderRadius:3,overflow:"hidden" }}>
            <div style={{ height:"100%",borderRadius:3,
              background:`linear-gradient(90deg,${T.cyan},${T.blue})`,
              width:`${scanPct}%`,transition:"width 0.26s ease",
              boxShadow:`0 0 12px ${T.cyan}` }}/>
          </div>
          <div style={{ marginTop:18,display:"flex",gap:7,flexWrap:"wrap" }}>
            {["Utilization","Storage","Autoscaling","Forecasting","Risk","CO₂","CLI","Terraform"].map((s,i)=>(
              <span key={s} style={{
                background:scanPct>(i+1)*11?T.cyanDim:T.subtle,
                color:scanPct>(i+1)*11?T.cyan:T.muted,
                border:`1px solid ${scanPct>(i+1)*11?T.cyan+"40":T.border}`,
                padding:"3px 9px",borderRadius:20,fontSize:10,fontWeight:700,
                fontFamily:T.mono,transition:"all .3s" }}>
                {scanPct>(i+1)*11?"✓ ":"○ "}{s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );

  /* ════════════════════════════════════════════════════════
     MAIN DASHBOARD
  ════════════════════════════════════════════════════════ */
  const TABS = [
    {id:"overview",       label:"Overview",   icon:"◈"},
    {id:"analysis",       label:"Analysis",   icon:"⬡"},
    {id:"recommendations",label:"Optimize",   icon:"◆"},
    {id:"forecast",       label:"Forecast",   icon:"△"},
    {id:"advisor",        label:"AI Advisor", icon:"✦"},
  ];

  return (
    <Shell>
      {/* NAVBAR */}
      <nav style={{ background:`${T.surface}f0`,backdropFilter:"blur(16px)",
        borderBottom:`1px solid ${T.border}`,
        padding:"0 24px",height:56,display:"flex",alignItems:"center",gap:16,
        position:"sticky",top:0,zIndex:100,flexWrap:"wrap" }}>
        <Logo/>
        {anomalies.length>0 && (
          <div style={{ flex:1,maxWidth:460,minWidth:200 }}>
            <AnomalyTicker items={anomalies}/>
          </div>
        )}
        <div style={{ marginLeft:"auto",display:"flex",gap:12,alignItems:"center",flexShrink:0 }}>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:10,color:T.muted,fontFamily:T.mono }}>MONTHLY SPEND</div>
            <div style={{ fontSize:14,fontWeight:800,color:T.text,fontFamily:T.mono }}>${totalCost.toLocaleString()}</div>
          </div>
          <div style={{ width:1,height:28,background:T.border }}/>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:10,color:T.muted,fontFamily:T.mono }}>SAVINGS AVAIL.</div>
            <div style={{ fontSize:14,fontWeight:800,color:T.green,fontFamily:T.mono }}>${totalSavings.toLocaleString()}</div>
          </div>
          <button onClick={()=>{setPhase("upload");setAnalyzed([]);setForecast([]);}}
            style={{ background:T.subtle,border:`1px solid ${T.border}`,
              color:T.muted,padding:"5px 12px",borderRadius:8,
              fontSize:11,cursor:"pointer",fontFamily:T.mono }}>↩ Reset</button>
        </div>
      </nav>

      {/* TABS */}
      <div style={{ background:T.surface,borderBottom:`1px solid ${T.border}`,
        padding:"0 24px",display:"flex",gap:2,overflowX:"auto" }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:"13px 16px",fontSize:13,fontWeight:700,
            color:tab===t.id?T.cyan:T.muted,
            borderBottom:`2px solid ${tab===t.id?T.cyan:"transparent"}`,
            background:"none",border:"none",
            cursor:"pointer",transition:"all .2s",fontFamily:T.display,
            display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap" }}>
            <span style={{ fontSize:11,opacity:.7 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* CONTENT */}
      <div style={{ flex:1,padding:"26px 24px",maxWidth:1440,margin:"0 auto",width:"100%" }}>

        {/* ══ OVERVIEW ══ */}
        {tab==="overview" && (
          <div>
            <PageTitle title="Cloud Overview"
              sub={`${analyzed.length} resources · ${[...new Set(analyzed.map(r=>r.region))].length} regions · ${[...new Set(analyzed.map(r=>r.provider))].length} providers`}/>

            <div style={{ display:"flex",gap:12,marginBottom:22,flexWrap:"wrap" }}>
              <KpiCard label="Cloud Efficiency"  value={`${efficiencyScore} / 100`}           icon="🎯" color={efficiencyColor} delay={0} sub="Overall Score"/>
              <KpiCard label="Total Resources"   value={analyzed.length}                      icon="🖥" color={T.cyan}   delay={70}   sub={providerStats.map(p=>`${p.name}:${p.count}`).join(" · ")}/>
              <KpiCard label="Monthly Spend"     value={`$${totalCost.toLocaleString()}`}     icon="💳" color={T.blue}  delay={140}  sub="Current period"/>
              <KpiCard label="Idle Resources"    value={idleCount}                            icon="😴" color={T.amber} delay={210} sub={`${Math.round(idleCount/analyzed.length*100)}% of fleet wasted`}/>
              <KpiCard label="Potential Savings" value={`$${totalSavings.toLocaleString()}`} icon="💰" color={T.green} delay={280} sub={`${savingsPct}% cost reduction`}/>
              <KpiCard label="CO₂ Offset/Mo"    value={`${totalCO2}kg`}                      icon="🌱" color={T.purple} delay={350} sub="From eliminating idle VMs"/>
            </div>

            <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr",gap:18,marginBottom:18 }}>
              <Card>
                <CardTitle title="CPU & Memory Utilisation" sub="Red = waste zone (<15%)"/>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={analyzed.map(r=>({ name:r.resource_id.replace("vm-",""), cpu:r.cpu_avg, mem:r.mem_avg }))} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border}/>
                    <XAxis dataKey="name" tick={{fill:T.muted,fontSize:10}}/>
                    <YAxis tick={{fill:T.muted,fontSize:10}} domain={[0,100]} tickFormatter={v=>`${v}%`}/>
                    <Tooltip contentStyle={TT} cursor={{fill:`${T.border}44`}}/>
                    <Bar dataKey="cpu" name="CPU %" radius={[4,4,0,0]}>
                      {analyzed.map((r,i)=><Cell key={i} fill={r.cpu_avg<15?T.red:r.cpu_avg<40?T.amber:T.green}/>)}
                    </Bar>
                    <Bar dataKey="mem" name="Mem %" fill={T.blue+"88"} radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <CardTitle title="Fleet Health Radar" sub="5-axis efficiency score"/>
                <ResponsiveContainer width="100%" height={220}>
                  <RadarChart data={radarData} cx="50%" cy="50%">
                    <PolarGrid stroke={T.border}/>
                    <PolarAngleAxis dataKey="metric" tick={{fill:T.muted,fontSize:10}}/>
                    <Radar dataKey="value" stroke={T.cyan} fill={T.cyan} fillOpacity={0.15} strokeWidth={2}/>
                  </RadarChart>
                </ResponsiveContainer>
              </Card>
            </div>

            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:18,marginBottom:18 }}>
              {/* Top Waste Resources Panel */}
              <Card>
                <CardTitle title="Top Cost Waste" sub="Resources with highest savings potential"/>
                <div style={{ display:"flex",flexDirection:"column",gap:12, marginTop: 10 }}>
                  {topWaste.map((w,i) => (
                    <div key={i} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",background:T.subtle,padding:"10px 14px",borderRadius:8,border:`1px solid ${T.border}` }}>
                      <div style={{ fontFamily:T.mono,fontSize:13,color:T.text,fontWeight:700 }}>{w.resource_id}</div>
                      <div style={{ color:T.green,fontFamily:T.mono,fontWeight:800,fontSize:13 }}>${w.savings} waste</div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Provider Cost Comparison */}
              <Card>
                <CardTitle title="Provider Cost Comparison" sub="Total spend vs potential savings by cloud"/>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={providerStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border}/>
                    <XAxis dataKey="name" tick={{fill:T.muted,fontSize:10}}/>
                    <YAxis tick={{fill:T.muted,fontSize:10}} />
                    <Tooltip contentStyle={TT} cursor={{fill:`${T.border}44`}} formatter={v=>`$${v}`}/>
                    <Bar dataKey="cost" name="Total Cost" fill={T.blue} radius={[4,4,0,0]}/>
                    <Bar dataKey="savings" name="Potential Savings" fill={T.green} radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              {/* Region Cost Analysis Chart */}
              <Card>
                <CardTitle title="Region Cost Analysis" sub="Cost and waste distribution across regions"/>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={regionData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border}/>
                    <XAxis dataKey="region" tick={{fill:T.muted,fontSize:8}}/>
                    <YAxis tick={{fill:T.muted,fontSize:10}} />
                    <Tooltip contentStyle={TT} cursor={{fill:`${T.border}44`}} formatter={v=>`$${v}`}/>
                    <Bar dataKey="cost" name="Total Cost" fill={T.amber} radius={[4,4,0,0]}/>
                    <Bar dataKey="waste" name="Waste" fill={T.red} radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              {/* Region Heatmap */}
              {regionData.length > 0 && (
                <Card style={{ gridColumn: "1 / -1" }}>
                  <CardTitle title="Region Cost Heatmap" sub="Regions colored by waste relative to cost"/>
                  <div style={{ display:"flex",gap:8,marginTop:10,flexWrap:"wrap" }}>
                    {regionData.map((r,i) => {
                      const intensity = r.cost > 0 ? (r.waste / r.cost) : 0;
                      const bColor = intensity > 0.5 ? T.red : intensity > 0.2 ? T.amber : T.green;
                      return (
                        <div key={i} style={{ flex:r.cost, minWidth:120, background:`${bColor}22`, border:`1px solid ${bColor}`, padding:16, borderRadius:8, display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center", textAlign:"center" }}>
                          <div style={{ fontFamily:T.mono, fontSize:12, fontWeight:700, color:T.text, marginBottom:4 }}>{r.region}</div>
                          <div style={{ color:bColor, fontWeight:800, fontSize:14 }}>${r.waste} waste</div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
            </div>

            {/* Provider breakdown */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12,marginBottom:18 }}>
              {providerStats.map(p=>(
                <div key={p.name} style={{ background:T.card,border:`1px solid ${T.border}`,
                  borderLeft:`3px solid ${PC[p.name]}`,borderRadius:14,padding:"16px 18px",
                  transition:"all .2s" }}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow=`0 0 20px ${PC[p.name]}18`}
                  onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:10 }}>
                    <span style={{ fontSize:16,fontWeight:900,color:PC[p.name],fontFamily:T.mono }}>{PI[p.name]} {p.name}</span>
                    <span style={{ fontSize:11,color:T.muted,fontFamily:T.mono }}>{p.count} VMs</span>
                  </div>
                  <div style={{ fontSize:22,fontWeight:800,fontFamily:T.mono }}>${p.cost.toLocaleString()}</div>
                  <div style={{ fontSize:11,color:T.muted,marginTop:3 }}>Monthly spend</div>
                  <div style={{ fontSize:13,color:T.green,fontWeight:700,marginTop:8,fontFamily:T.mono }}>
                    −${p.savings.toLocaleString()} potential
                  </div>
                </div>
              ))}
            </div>

            {/* Resource table */}
            <Card>
              <CardTitle title="Resource Fleet" sub="Click a row to toggle CLI / Terraform remediation"/>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
                  <thead>
                    <tr>
                      {["","ID","Provider","Type","Region","CPU","Mem","Storage","Cost/Mo","Risk","Savings"].map(h=>(
                        <th key={h} style={{ textAlign:"left",padding:"9px 11px",color:T.muted,
                          fontWeight:700,fontSize:10,borderBottom:`1px solid ${T.border}`,
                          letterSpacing:"0.06em",textTransform:"uppercase",fontFamily:T.mono,whiteSpace:"nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analyzed.map((r,i)=>(
                      <>
                        <tr key={i}
                          onClick={()=>setCliOpen(cliOpen===i?null:i)}
                          style={{ borderBottom:`1px solid ${T.border}20`,cursor:"pointer",
                            background:cliOpen===i?T.subtle:"transparent",transition:"background .15s" }}
                          onMouseEnter={e=>{ if(cliOpen!==i) e.currentTarget.style.background=T.subtle+"80"; }}
                          onMouseLeave={e=>{ if(cliOpen!==i) e.currentTarget.style.background="transparent"; }}>
                          <td style={{ padding:"10px 11px" }}>
                            <div style={{ width:7,height:7,borderRadius:"50%",margin:"0 auto",
                              background:r.isIdle?T.red:r.isOver?T.amber:T.green,
                              boxShadow:`0 0 5px ${r.isIdle?T.red:r.isOver?T.amber:T.green}` }}/>
                          </td>
                          <td style={{ padding:"10px 11px",fontFamily:T.mono,color:T.cyan,fontWeight:700 }}>{r.resource_id}</td>
                          <td style={{ padding:"10px 11px",color:PC[r.provider],fontWeight:700 }}>{r.provider}</td>
                          <td style={{ padding:"10px 11px",color:T.muted }}>{r.type}</td>
                          <td style={{ padding:"10px 11px",color:T.muted,fontSize:11 }}>{r.region}</td>
                          <td style={{ padding:"10px 11px" }}>
                            <div style={{ display:"flex",alignItems:"center",gap:5 }}>
                              <div style={{ width:36,height:3,background:T.border,borderRadius:2 }}>
                                <div style={{ width:`${r.cpu_avg}%`,height:"100%",borderRadius:2,
                                  background:r.cpu_avg<15?T.red:r.cpu_avg<40?T.amber:T.green }}/>
                              </div>
                              <span style={{ fontFamily:T.mono,fontSize:11 }}>{r.cpu_avg}%</span>
                            </div>
                          </td>
                          <td style={{ padding:"10px 11px",fontFamily:T.mono,fontSize:11 }}>{r.mem_avg}%</td>
                          <td style={{ padding:"10px 11px",fontFamily:T.mono,fontSize:11 }}>{r.storage_gb.toLocaleString()} GB</td>
                          <td style={{ padding:"10px 11px",fontFamily:T.mono,fontWeight:700 }}>${r.monthly_cost.toLocaleString()}</td>
                          <td style={{ padding:"10px 11px" }}><RiskPill level={r.risk}/></td>
                          <td style={{ padding:"10px 11px",fontFamily:T.mono,color:T.green,fontWeight:800 }}>${r.savings.toLocaleString()}</td>
                        </tr>
                        {cliOpen===i && (
                          <tr key={`cli-${i}`}>
                            <td colSpan={11} style={{ padding:0 }}>
                              <div style={{ background:T.subtle,borderBottom:`1px solid ${T.border}`,
                                padding:"14px 16px",animation:"fadeIn .25s ease" }}>
                                <div style={{ display:"flex",gap:10,marginBottom:12,alignItems:"center" }}>
                                  <span style={{ fontSize:12,fontWeight:700,color:T.cyan,fontFamily:T.mono }}>
                                    ⚙ Remediation — {r.resource_id}
                                  </span>
                                  <button onClick={e=>{e.stopPropagation();setTfOpen(tfOpen===i?null:i);}}
                                    style={{ background:tfOpen===i?T.purpleDim:T.card,border:`1px solid ${T.border}`,
                                      color:tfOpen===i?T.purple:T.muted,padding:"3px 10px",borderRadius:6,
                                      fontSize:10,cursor:"pointer",fontFamily:T.mono,fontWeight:700,marginLeft:"auto" }}>
                                    {tfOpen===i?"◀ CLI":"▶ Terraform"}
                                  </button>
                                </div>
                                {(tfOpen===i ? r.terraformFix : r.cliCmds).map((cmd,k)=>(
                                  <div key={k} style={{ fontFamily:T.mono,fontSize:11,color:tfOpen===i?T.purple:T.green,
                                    background:T.card,border:`1px solid ${T.border}`,borderRadius:8,
                                    padding:"8px 12px",marginBottom:6,
                                    display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8 }}>
                                    <pre style={{ margin:0,whiteSpace:"pre-wrap",wordBreak:"break-all",flex:1 }}>{cmd}</pre>
                                    <button onClick={e=>{e.stopPropagation();copyText(cmd,`${i}-${k}`);}}
                                      style={{ background:copied===`${i}-${k}`?T.greenDim:T.cyanDim,
                                        border:`1px solid ${copied===`${i}-${k}`?T.green:T.cyan}40`,
                                        color:copied===`${i}-${k}`?T.green:T.cyan,
                                        padding:"3px 9px",borderRadius:5,fontSize:9,cursor:"pointer",
                                        whiteSpace:"nowrap",fontFamily:T.mono,fontWeight:700,flexShrink:0 }}>
                                      {copied===`${i}-${k}`?"✓ COPIED":"COPY"}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* ══ ANALYSIS ══ */}
        {tab==="analysis" && (
          <div>
            <PageTitle title="Architecture Analysis" sub="ML-detected inefficiencies, deployment risks, and waste patterns"/>

            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20 }}>
              {[
                {label:"Overprovisioned",count:analyzed.filter(r=>r.isOver).length,   color:T.amber, icon:"📦",desc:"CPU+Mem < 20%"},
                {label:"Idle Instances", count:analyzed.filter(r=>r.isIdle).length,   color:T.red,   icon:"😴",desc:"> 60% idle time"},
                {label:"No Autoscaling", count:analyzed.filter(r=>r.noScale).length,  color:T.purple,icon:"⚡",desc:"Manual scaling only"},
                {label:"High Storage",   count:analyzed.filter(r=>r.isBigStore).length,color:T.blue, icon:"🗄",desc:"> 400 GB provisioned"},
              ].map(it=>(
                <div key={it.label} style={{ background:T.card,border:`1px solid ${T.border}`,
                  borderTop:`2px solid ${it.color}`,borderRadius:14,padding:"16px 18px" }}>
                  <div style={{ fontSize:22,marginBottom:6 }}>{it.icon}</div>
                  <div style={{ fontSize:30,fontWeight:900,color:it.color,fontFamily:T.mono }}>{it.count}</div>
                  <div style={{ fontSize:13,fontWeight:700,marginTop:4 }}>{it.label}</div>
                  <div style={{ fontSize:11,color:T.muted,marginTop:4 }}>{it.desc}</div>
                </div>
              ))}
            </div>

            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:18 }}>
              <Card>
                <CardTitle title="Cost vs Recoverable Waste" sub="Stacked: optimized cost + waste overhead"/>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={analyzed.map(r=>({name:r.resource_id.replace("vm-",""),cost:r.monthly_cost-r.savings,waste:r.savings}))} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border} horizontal={false}/>
                    <XAxis type="number" tick={{fill:T.muted,fontSize:10}} tickFormatter={v=>`$${v}`}/>
                    <YAxis type="category" dataKey="name" tick={{fill:T.muted,fontSize:10}} width={80}/>
                    <Tooltip contentStyle={TT} formatter={v=>`$${v}`}/>
                    <Bar dataKey="cost"  stackId="s" fill={T.blue+"88"} name="Optimized Cost" radius={[0,0,0,0]}/>
                    <Bar dataKey="waste" stackId="s" fill={T.red+"cc"}  name="Recoverable Waste" radius={[0,4,4,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <CardTitle title="Storage by Resource" sub="Orange/red = archive candidate"/>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={analyzed.map(r=>({name:r.resource_id.replace("vm-",""),gb:r.storage_gb}))}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border}/>
                    <XAxis dataKey="name" tick={{fill:T.muted,fontSize:10}}/>
                    <YAxis tick={{fill:T.muted,fontSize:10}} tickFormatter={v=>`${v}GB`}/>
                    <Tooltip contentStyle={TT} formatter={v=>`${v} GB`}/>
                    <Bar dataKey="gb" name="Storage GB" radius={[4,4,0,0]}>
                      {analyzed.map((r,i)=><Cell key={i} fill={r.storage_gb>800?T.red:r.storage_gb>400?T.amber:T.green}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>

            {/* Risk grid */}
            <Card>
              <CardTitle title="Per-Resource Risk Breakdown" sub="Detected architecture issues per VM"/>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:12 }}>
                {analyzed.map((r,i)=>(
                  <div key={i} style={{ background:T.surface,borderRadius:12,
                    border:`1px solid ${r.risk==="High"?T.red+"44":r.risk==="Medium"?T.amber+"44":T.border}`,
                    padding:14,transition:"transform .2s" }}
                    onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
                    onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:9 }}>
                      <div>
                        <div style={{ fontFamily:T.mono,fontSize:12,fontWeight:700,color:T.cyan }}>{r.resource_id}</div>
                        <div style={{ fontSize:10,color:T.muted,marginTop:2 }}>{r.provider} {r.type} · {r.region}</div>
                      </div>
                      <RiskPill level={r.risk}/>
                    </div>
                    <div style={{ display:"flex",gap:5,flexWrap:"wrap",marginBottom:8 }}>
                      {r.isOver     && <Tag color={T.amber}>OVERPROVISIONED</Tag>}
                      {r.isIdle     && <Tag color={T.red}>IDLE</Tag>}
                      {r.noScale    && <Tag color={T.purple}>NO AUTOSCALE</Tag>}
                      {r.isBigStore && <Tag color={T.blue}>HIGH STORAGE</Tag>}
                      {!r.isOver&&!r.isIdle&&!r.noScale&&!r.isBigStore && <Tag color={T.green}>HEALTHY</Tag>}
                    </div>
                    <div style={{ display:"flex",justifyContent:"space-between" }}>
                      <span style={{ fontSize:10,color:T.muted }}>Potential saving</span>
                      <span style={{ fontSize:11,color:T.green,fontFamily:T.mono,fontWeight:700 }}>${r.savings}/mo</span>
                    </div>
                    <div style={{ display:"flex",justifyContent:"space-between",marginTop:3 }}>
                      <span style={{ fontSize:10,color:T.muted }}>CO₂ offset</span>
                      <span style={{ fontSize:11,color:T.purple,fontFamily:T.mono,fontWeight:700 }}>{r.co2} kg/mo 🌱</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ══ RECOMMENDATIONS ══ */}
        {tab==="recommendations" && (
          <div>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start", flexWrap:"wrap", gap: 16 }}>
              <PageTitle title="Optimization Plan"
                sub={<>AI-prioritised · Save <span style={{color:T.green,fontWeight:800}}>${totalSavings.toLocaleString()}/mo</span> · <span style={{color:T.purple,fontWeight:700}}>{totalCO2} kg CO₂/mo</span></>}/>
              
              <div style={{ display:"flex",gap:12, flexWrap: "wrap", marginBottom: 22 }}>
                <button onClick={generatePDF} style={{ background:T.card,border:`1px solid ${T.blue}`,color:T.blue,padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:700,fontFamily:T.display,cursor:"pointer",transition:"all .2s" }} onMouseEnter={e=>{e.currentTarget.style.background=T.blueDim;e.currentTarget.style.boxShadow=`0 0 10px ${T.blue}40`;}} onMouseLeave={e=>{e.currentTarget.style.background=T.card;e.currentTarget.style.boxShadow="none";}}>
                  📄 Download Optimization Report (PDF)
                </button>
                <button onClick={generatePlan} style={{ background:`linear-gradient(135deg,${T.cyan},${T.blue})`,border:"none",color:T.bg,padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:800,fontFamily:T.display,cursor:"pointer",transition:"all .2s" }} onMouseEnter={e=>{e.currentTarget.style.opacity=0.8;e.currentTarget.style.boxShadow=`0 0 10px ${T.cyan}60`;}} onMouseLeave={e=>{e.currentTarget.style.opacity=1;e.currentTarget.style.boxShadow="none";}}>
                  📅 Generate 30-Day Optimization Plan
                </button>
              </div>
            </div>

            {aiPlan && (
              <Card style={{ marginBottom:20, borderLeft:`4px solid ${T.cyan}` }}>
                <CardTitle title="30-Day AI Optimization Plan" sub="Structured weekly goals to cut costs and improve efficiency"/>
                <div style={{ display:"flex", gap:16, marginTop:12, flexWrap:"wrap" }}>
                  {aiPlan.map((step, i) => (
                    <div key={i} style={{ flex:1, minWidth:200, background:T.subtle, padding:"14px 18px", borderRadius:10, border:`1px solid ${T.border}` }}>
                      <div style={{ color:T.cyan, fontWeight:800, fontSize:12, fontFamily:T.mono, marginBottom:8 }}>{step.week}</div>
                      <div style={{ color:T.text, fontSize:14, fontWeight:600 }}>{step.action}</div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Summary banner */}
            <div style={{ background:T.card,border:`1px solid ${T.green}30`,borderRadius:14,
              padding:"14px 22px",marginBottom:20,display:"flex",gap:28,alignItems:"center",flexWrap:"wrap" }}>
              {[
                {label:"Annual Savings",  value:`$${(totalSavings*12).toLocaleString()}`, color:T.green},
                {label:"Cost Reduction",  value:`${savingsPct}%`,                         color:T.cyan},
                {label:"CO₂ Offset",      value:`${totalCO2} kg/mo`,                      color:T.purple},
                {label:"High Risk VMs",   value:highRisk,                                  color:T.red},
              ].map((s,i)=>(
                <div key={i}>
                  <div style={{ fontSize:10,color:T.muted,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:"0.07em" }}>{s.label}</div>
                  <div style={{ fontSize:26,fontWeight:900,color:s.color,fontFamily:T.mono }}>{s.value}</div>
                </div>
              ))}
              <div style={{ marginLeft:"auto" }}>
                <div style={{ fontSize:10,color:T.muted,marginBottom:5,fontFamily:T.mono }}>OVERALL SAVINGS RATE</div>
                <div style={{ width:180,height:7,background:T.border,borderRadius:4 }}>
                  <div style={{ width:`${savingsPct}%`,height:"100%",borderRadius:4,
                    background:`linear-gradient(90deg,${T.green},${T.cyan})`,
                    boxShadow:`0 0 10px ${T.green}` }}/>
                </div>
              </div>
            </div>

            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              {analyzed.sort((a,b)=>b.savings-a.savings).map((r,i)=>(
                <div key={i} style={{ background:T.card,
                  border:`1px solid ${T.border}`,
                  borderLeft:`3px solid ${r.risk==="High"?T.red:r.risk==="Medium"?T.amber:T.green}`,
                  borderRadius:14,padding:20,transition:"all .2s" }}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow=`0 4px 24px ${T.bg}80`}
                  onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14 }}>
                    <div style={{ display:"flex",gap:12,alignItems:"flex-start" }}>
                      <div style={{ width:38,height:38,borderRadius:10,flexShrink:0,
                        background:r.savings>800?T.redDim:r.savings>300?T.amberDim:T.greenDim,
                        display:"flex",alignItems:"center",justifyContent:"center",fontSize:18 }}>
                        {r.isIdle?"😴":r.isOver?"📦":r.isBigStore?"🗄":"✅"}
                      </div>
                      <div>
                        <div style={{ display:"flex",gap:8,alignItems:"center",marginBottom:4,flexWrap:"wrap" }}>
                          <span style={{ fontFamily:T.mono,fontSize:13,fontWeight:800,color:T.cyan }}>{r.resource_id}</span>
                          <span style={{ color:PC[r.provider],fontSize:11,fontWeight:700 }}>{r.provider}</span>
                          <RiskPill level={r.risk}/>
                        </div>
                        <div style={{ fontSize:12,color:T.muted }}>
                          {r.type} · {r.region} · CPU {r.cpu_avg}% · Mem {r.mem_avg}% · {r.hours_idle}h idle
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign:"right",flexShrink:0 }}>
                      <div style={{ fontSize:24,fontWeight:900,color:T.green,fontFamily:T.mono }}>−${r.savings.toLocaleString()}</div>
                      <div style={{ fontSize:11,color:T.muted,fontFamily:T.mono }}>per month</div>
                      <div style={{ fontSize:11,color:T.purple,marginTop:4 }}>🌱 {r.co2} kg CO₂</div>
                    </div>
                  </div>

                  <div style={{ borderTop:`1px solid ${T.border}`,paddingTop:12 }}>
                    <div style={{ fontSize:10,fontWeight:800,color:T.muted,textTransform:"uppercase",
                      letterSpacing:"0.08em",marginBottom:8,fontFamily:T.mono }}>Action Items</div>
                    <div style={{ display:"flex",flexDirection:"column",gap:7,marginBottom:12 }}>
                      {r.actions.map((a,j)=>(
                        <div key={j} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:10 }}>
                          <div style={{ display:"flex",alignItems:"center",gap:8,fontSize:13,color:T.text }}>
                            <span>{a.icon}</span>{a.text}
                          </div>
                          <span style={{ background:a.impact==="High"?T.redDim:a.impact==="Medium"?T.amberDim:T.greenDim,
                            color:a.impact==="High"?T.red:a.impact==="Medium"?T.amber:T.green,
                            border:`1px solid currentColor`,padding:"2px 8px",borderRadius:20,
                            fontSize:9,fontWeight:800,fontFamily:T.mono,textTransform:"uppercase",flexShrink:0 }}>
                            {a.impact} IMPACT
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Expandable CLI / Terraform */}
                    {r.cliCmds.length>0 && (
                      <details style={{ marginTop:4 }}>
                        <summary style={{ cursor:"pointer",fontSize:12,color:T.cyan,
                          fontFamily:T.mono,fontWeight:700,userSelect:"none",
                          display:"flex",alignItems:"center",gap:6 }}>
                          ⚙ CLI &amp; Terraform Scripts ({r.cliCmds.length})
                        </summary>
                        <div style={{ marginTop:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                          <div>
                            <div style={{ fontSize:10,color:T.cyan,fontFamily:T.mono,fontWeight:700,marginBottom:6 }}>AWS CLI</div>
                            {r.cliCmds.map((cmd,k)=>(
                              <CmdBlock key={k} cmd={cmd} color={T.green} copyKey={`rec-cli-${i}-${k}`} copied={copied} onCopy={copyText}/>
                            ))}
                          </div>
                          <div>
                            <div style={{ fontSize:10,color:T.purple,fontFamily:T.mono,fontWeight:700,marginBottom:6 }}>Terraform HCL</div>
                            {r.terraformFix.map((cmd,k)=>(
                              <CmdBlock key={k} cmd={cmd} color={T.purple} copyKey={`rec-tf-${i}-${k}`} copied={copied} onCopy={copyText}/>
                            ))}
                          </div>
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ FORECAST ══ */}
        {tab==="forecast" && (
          <div>
            <PageTitle title="Cost Forecast" sub="ML-powered 6-month projection with optimisation scenario modelling"/>

            <div style={{ display:"flex",gap:12,marginBottom:22,flexWrap:"wrap" }}>
              <KpiCard label="Current Monthly"      value={`$${totalCost.toLocaleString()}`}                                     icon="💳" color={T.blue}  delay={0}/>
              <KpiCard label="Next Month (as-is)"   value={`$${forecast[1]?.projected.toLocaleString()}`}                        icon="📈" color={T.amber} delay={70}  sub="Without changes"/>
              <KpiCard label="Next Month (optimised)"value={`$${forecast[1]?.optimized.toLocaleString()}`}                       icon="📉" color={T.green} delay={140} sub="After recommendations"/>
              <KpiCard label="6-Mo Total Savings"   value={`$${forecast.reduce((s,f)=>s+(f.projected-f.optimized),0).toLocaleString()}`} icon="💰" color={T.cyan} delay={210}/>
            </div>

            <Card style={{ marginBottom:18 }}>
              <CardTitle title="Projected vs Optimised Spend" sub="Apply all recommendations to stay on the green line"/>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={forecast}>
                  <defs>
                    <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={T.red}   stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={T.red}   stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="og" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={T.green} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={T.green} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.border}/>
                  <XAxis dataKey="month" tick={{fill:T.muted,fontSize:12}}/>
                  <YAxis tick={{fill:T.muted,fontSize:12}} tickFormatter={v=>`$${(v/1000).toFixed(1)}k`}/>
                  <Tooltip contentStyle={TT} formatter={v=>`$${v.toLocaleString()}`}/>
                  <Area type="monotone" dataKey="projected" stroke={T.red}   fill="url(#pg)" strokeWidth={2.5} name="As-Is"     dot={{fill:T.red,r:4}}/>
                  <Area type="monotone" dataKey="optimized" stroke={T.green} fill="url(#og)" strokeWidth={2.5} name="Optimised" dot={{fill:T.green,r:4}}/>
                </AreaChart>
              </ResponsiveContainer>
              <div style={{ display:"flex",gap:20,justifyContent:"center",marginTop:10 }}>
                <Legend color={T.red}   label="Without optimisation"/>
                <Legend color={T.green} label="With optimisation"/>
              </div>
            </Card>

            <Card>
              <CardTitle title="Month-by-Month Breakdown"/>
              <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
                <thead>
                  <tr>
                    {["Month","Projected","Optimised","Savings","Reduction"].map(h=>(
                      <th key={h} style={{ textAlign:"left",padding:"9px 13px",color:T.muted,
                        fontWeight:700,fontSize:10,borderBottom:`1px solid ${T.border}`,
                        textTransform:"uppercase",letterSpacing:"0.06em",fontFamily:T.mono }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((f,i)=>{
                    const pct = Math.round((f.projected-f.optimized)/f.projected*100);
                    return (
                      <tr key={i} style={{ borderBottom:`1px solid ${T.border}20` }}
                        onMouseEnter={e=>e.currentTarget.style.background=T.subtle}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <td style={{ padding:"11px 13px",fontWeight:800 }}>
                          {f.month} {i===0 && <span style={{color:T.cyan,fontSize:10,fontFamily:T.mono}}>(NOW)</span>}
                        </td>
                        <td style={{ padding:"11px 13px",fontFamily:T.mono,color:T.red }}>${f.projected.toLocaleString()}</td>
                        <td style={{ padding:"11px 13px",fontFamily:T.mono,color:T.green }}>${f.optimized.toLocaleString()}</td>
                        <td style={{ padding:"11px 13px",fontFamily:T.mono,color:T.green,fontWeight:800 }}>−${(f.projected-f.optimized).toLocaleString()}</td>
                        <td style={{ padding:"11px 13px" }}>
                          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                            <div style={{ width:90,height:5,background:T.border,borderRadius:3 }}>
                              <div style={{ width:`${pct}%`,height:"100%",borderRadius:3,
                                background:`linear-gradient(90deg,${T.green},${T.cyan})` }}/>
                            </div>
                            <span style={{ fontFamily:T.mono,fontSize:12,color:T.green,fontWeight:700 }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {/* ══ AI ADVISOR ══ */}
        {tab==="advisor" && (
          <div style={{ display:"flex",gap:18,height:"calc(100vh - 200px)",minHeight:520 }}>
            <div style={{ flex:1,display:"flex",flexDirection:"column" }}>
              <div style={{ marginBottom:16 }}>
                <h2 style={{ fontSize:22,fontWeight:900,fontFamily:T.display,letterSpacing:"-0.03em",marginBottom:3 }}>
                  ARIA — AI Resource Intelligence Advisor
                </h2>
                <p style={{ color:T.muted,fontSize:13 }}>Powered by Claude · Full context of your {analyzed.length} cloud resources</p>
              </div>

              <div style={{ background:T.card,border:`1px solid ${T.border}`,
                borderRadius:16,flex:1,display:"flex",flexDirection:"column",overflow:"hidden" }}>
                <div style={{ flex:1,overflowY:"auto",padding:18,
                  display:"flex",flexDirection:"column",gap:14 }}>
                  {chat.map((m,i)=>(
                    <div key={i} style={{ display:"flex",gap:10,
                      flexDirection:m.role==="user"?"row-reverse":"row" }}>
                      <div style={{ width:32,height:32,borderRadius:9,flexShrink:0,
                        background:m.role==="user"?T.blueDim:T.cyanDim,
                        border:`1px solid ${m.role==="user"?T.blue+"40":T.cyan+"40"}`,
                        display:"flex",alignItems:"center",justifyContent:"center",fontSize:14 }}>
                        {m.role==="user"?"👤":"✦"}
                      </div>
                      <div style={{ background:m.role==="user"?T.blueDim:T.subtle,
                        border:`1px solid ${m.role==="user"?T.blue+"30":T.border}`,
                        borderRadius:11,padding:"11px 15px",
                        maxWidth:"78%",fontSize:13,lineHeight:1.7,color:T.text,
                        whiteSpace:"pre-wrap" }}>
                        {m.text.replace(/\*\*(.*?)\*\*/g,"$1")}
                      </div>
                    </div>
                  ))}
                  {chatBusy && (
                    <div style={{ display:"flex",gap:10 }}>
                      <div style={{ width:32,height:32,borderRadius:9,background:T.cyanDim,
                        border:`1px solid ${T.cyan}40`,display:"flex",alignItems:"center",justifyContent:"center" }}>✦</div>
                      <div style={{ background:T.subtle,border:`1px solid ${T.border}`,
                        borderRadius:11,padding:"12px 15px",
                        display:"flex",gap:5,alignItems:"center" }}>
                        {[0,1,2].map(j=>(
                          <div key={j} style={{ width:7,height:7,borderRadius:"50%",background:T.cyan,
                            animation:`dots 1.2s ease ${j*0.2}s infinite` }}/>
                        ))}
                        <span style={{ marginLeft:8,fontSize:11,color:T.muted,fontFamily:T.mono }}>ARIA thinking…</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEnd}/>
                </div>
                <div style={{ borderTop:`1px solid ${T.border}`,padding:14 }}>
                  <div style={{ display:"flex",gap:9 }}>
                    <input value={chatIn} onChange={e=>setChatIn(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendChat()}
                      placeholder="Ask ARIA about your cloud data, costs, risks, Terraform…"
                      style={{ flex:1,background:T.subtle,border:`1px solid ${T.border}`,
                        borderRadius:9,padding:"11px 15px",color:T.text,fontSize:13,
                        outline:"none",fontFamily:T.display,transition:"border-color .2s" }}
                      onFocus={e=>e.target.style.borderColor=T.cyan+"60"}
                      onBlur={e=>e.target.style.borderColor=T.border}/>
                    <button onClick={sendChat} disabled={chatBusy||!chatIn.trim()}
                      style={{ background:chatBusy||!chatIn.trim()?T.subtle
                        :`linear-gradient(135deg,${T.cyan},${T.blue})`,
                        border:"none",borderRadius:9,padding:"11px 20px",
                        color:chatBusy||!chatIn.trim()?T.muted:T.bg,
                        fontSize:13,fontWeight:800,
                        cursor:chatBusy||!chatIn.trim()?"not-allowed":"pointer",
                        transition:"all .2s",fontFamily:T.display }}>
                      Send ↑
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div style={{ width:240,display:"flex",flexDirection:"column",gap:8,paddingTop:52 }}>
              <div style={{ fontSize:9,fontWeight:800,color:T.muted,textTransform:"uppercase",
                letterSpacing:"0.1em",fontFamily:T.mono,marginBottom:4 }}>QUICK PROMPTS</div>
              {[
                "Which VMs are wasting the most money?",
                "What's my biggest architecture risk?",
                "How do I reduce storage costs fast?",
                "Show ROI if I apply all recommendations",
                "Which instances terminate first?",
                "CO₂ impact of my idle VMs?",
                "Compare AWS vs GCP efficiency",
                "Write a Terraform fix for top issue",
                "Give me a 30-day action plan",
              ].map((q,i)=>(
                <button key={i} onClick={()=>setChatIn(q)}
                  style={{ background:T.card,border:`1px solid ${T.border}`,
                    borderRadius:9,padding:"8px 12px",color:T.muted,
                    fontSize:11,textAlign:"left",cursor:"pointer",
                    transition:"all .15s",lineHeight:1.4,fontFamily:T.display }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=T.cyan+"50";e.currentTarget.style.color=T.text;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.muted;}}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

      </div>
    </Shell>
  );
}

/* ─── LAYOUT ATOMS ───────────────────────────────────────────────────────────── */
function Shell({ children, center }) {
  return (
    <div style={{ minHeight:"100vh",background:T.bg,color:T.text,
      fontFamily:T.display,display:"flex",flexDirection:"column",
      ...(center?{alignItems:"center",justifyContent:"center",gap:0}:{}) }}>
      <Fonts/><GlobalCSS/>
      {children}
    </div>
  );
}
const NavBar = ({children}) => (
  <nav style={{ borderBottom:`1px solid ${T.border}`,padding:"0 36px",height:58,
    display:"flex",alignItems:"center",gap:14,position:"relative",zIndex:10,
    background:`${T.surface}ee`,backdropFilter:"blur(12px)" }}>{children}</nav>
);
const Logo = () => (
  <div style={{ display:"flex",alignItems:"center",gap:9 }}>
    <div style={{ width:30,height:30,borderRadius:7,
      background:`linear-gradient(135deg,${T.cyan},${T.blue})`,
      display:"flex",alignItems:"center",justifyContent:"center",
      fontSize:14,fontWeight:900,color:T.bg,fontFamily:T.mono }}>N</div>
    <span style={{ fontSize:15,fontWeight:900,fontFamily:T.display,letterSpacing:"-0.02em" }}>NimbusIQ</span>
  </div>
);
const Pill = ({color,children}) => (
  <span style={{ background:`${color}15`,color,border:`1px solid ${color}30`,
    padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:800,fontFamily:T.mono }}>{children}</span>
);
const Orb = ({style}) => (
  <div style={{ position:"fixed",pointerEvents:"none",filter:"blur(40px)",...style }}/>
);
const Card = ({children,style={}}) => (
  <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:22,...style }}>{children}</div>
);
const CardTitle = ({title,sub}) => (
  <div style={{ marginBottom:14 }}>
    <div style={{ fontSize:14,fontWeight:700,marginBottom:sub?3:0 }}>{title}</div>
    {sub && <div style={{ fontSize:12,color:T.muted }}>{sub}</div>}
  </div>
);
const PageTitle = ({title,sub}) => (
  <div style={{ marginBottom:22 }}>
    <h2 style={{ fontSize:22,fontWeight:900,fontFamily:T.display,letterSpacing:"-0.03em",marginBottom:3 }}>{title}</h2>
    <p style={{ color:T.muted,fontSize:13 }}>{sub}</p>
  </div>
);
const Legend = ({color,label}) => (
  <div style={{ display:"flex",gap:7,alignItems:"center",fontSize:12,color:T.muted }}>
    <div style={{ width:22,height:2.5,background:color,borderRadius:2 }}/>{label}
  </div>
);
const CmdBlock = ({cmd,color,copyKey,copied,onCopy}) => (
  <div style={{ fontFamily:T.mono,fontSize:11,color,
    background:T.card,border:`1px solid ${T.border}`,borderRadius:7,
    padding:"7px 10px",marginBottom:5,
    display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8 }}>
    <pre style={{ margin:0,whiteSpace:"pre-wrap",wordBreak:"break-all",flex:1 }}>{cmd}</pre>
    <button onClick={()=>onCopy(cmd,copyKey)}
      style={{ background:copied===copyKey?T.greenDim:T.cyanDim,
        border:`1px solid ${copied===copyKey?T.green:T.cyan}40`,
        color:copied===copyKey?T.green:T.cyan,
        padding:"2px 8px",borderRadius:4,fontSize:9,cursor:"pointer",
        whiteSpace:"nowrap",fontFamily:T.mono,fontWeight:700,flexShrink:0 }}>
      {copied===copyKey?"✓":"COPY"}
    </button>
  </div>
);

/* ─── FONTS & CSS ─────────────────────────────────────────────────────────────── */
const Fonts = () => (
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>
);
const GlobalCSS = () => (
  <style>{`
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:${T.bg}}
    ::-webkit-scrollbar{width:5px;height:5px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
    input::placeholder{color:${T.muted}}
    details>summary{list-style:none}
    details>summary::-webkit-details-marker{display:none}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
    @keyframes dots{0%,100%{transform:scale(.6);opacity:.4}50%{transform:scale(1.2);opacity:1}}
    @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    @keyframes pulse-ring{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.5}50%{transform:translate(-50%,-50%) scale(1.08);opacity:.8}}
    @keyframes spin-slow{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  `}</style>
);
