import { useState, useMemo, useEffect, useCallback } from "react";
import { supabase } from "./supabase.js";

// FLASH_LINK agora gerenciado via configuracoes (fd_flash_link no localStorage)
const SINAL_VALOR = 50;
const EMAILJS_SERVICE_ID  = "service_cbqrtib";
const EMAILJS_TEMPLATE_ID = "template_b6nlu5t";
const EMAILJS_PUBLIC_KEY  = "6TsrRDqsj936zntur";
const NOTIF_EMAIL = "inkstation925@gmail.com";
const STATUS_LABELS = { pending:"Aguardando sinal", confirmed:"Confirmado", done:"Realizado", cancelled:"Cancelado" };

const T = {
  bg:"#080808", surface:"#111111", surface2:"#181818", surface3:"#222222",
  border:"#232323", border2:"#2e2e2e", accent:"#e63946", accentDim:"#e6394618",
  text:"#f0f0f0", textMuted:"#777777", textDim:"#444444",
  green:"#22c55e", greenDim:"#22c55e18", amber:"#f59e0b", amberDim:"#f59e0b18",
  red:"#e63946", redDim:"#e6394618", gray:"#555555", grayDim:"#55555518",
};

const inp = {
  width:"100%", background:T.surface3, border:`1px solid ${T.border2}`,
  borderRadius:8, padding:"10px 14px", color:T.text, fontSize:14,
  fontFamily:"'DM Sans',sans-serif", outline:"none", boxSizing:"border-box",
  WebkitAppearance:"none",
};
const lbl = { fontSize:11, color:T.textMuted, marginBottom:5, display:"block", letterSpacing:"0.07em", textTransform:"uppercase" };
const btnP = { background:T.accent, color:"#fff", border:"none", borderRadius:8, padding:"11px 20px", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" };
const btnS = { background:"transparent", color:T.textMuted, border:`1px solid ${T.border2}`, borderRadius:8, padding:"11px 20px", fontSize:14, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" };
const btnD = { background:"#200c0c", color:T.red, border:`1px solid ${T.redDim}`, borderRadius:8, padding:"11px 20px", fontSize:14, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" };

function genSlots(startTime, endTime, interval) {
  const toMin = t => { const [h, m] = t.split(":").map(Number); return h*60+m; };
  const toTime = m => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
  const slots = []; let cur = toMin(startTime); const end = toMin(endTime);
  while (cur < end) { slots.push({ id:`slot-${cur}`, time:toTime(cur), blocked:false }); cur += Number(interval); }
  return slots;
}
function fmtDate(d) {
  if (!d) return "";
  const [y,m,day] = d.split("-");
  const months = ["janeiro","fevereiro","marco","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return `${parseInt(day)} de ${months[parseInt(m)-1]} de ${y}`;
}
function fmtPhone(v) {
  v = v.replace(/\D/g,"").slice(0,11);
  if (v.length<=2) return v.length?`(${v}`:"";
  if (v.length<=6) return `(${v.slice(0,2)}) ${v.slice(2)}`;
  if (v.length<=10) return `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`;
  return `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
}
function calcAge(dob) {
  if (!dob) return 0;
  const today = new Date(), birth = new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const mo = today.getMonth() - birth.getMonth();
  if (mo < 0 || (mo===0 && today.getDate() < birth.getDate())) age--;
  return age;
}
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) { crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1; crc &= 0xFFFF; }
  }
  return crc;
}
function genPixPayload(pixConfig, valor) {
  if (!pixConfig?.key) return null;
  const tlv = (id, v) => id + String(v.length).padStart(2,"0") + v;
  const merchant = tlv("26", tlv("00","BR.GOV.BCB.PIX") + tlv("01", pixConfig.key));
  const name = (pixConfig.holderName || "Ink Station").slice(0,25).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
  const additional = tlv("62", tlv("05","***"));
  const payload = tlv("00","01") + merchant + tlv("52","0000") + tlv("53","986") +
    tlv("54", Number(valor).toFixed(2)) + tlv("58","BR") + tlv("59", name) +
    tlv("60","SAO BERNARDO") + additional + "6304";
  return payload + crc16(payload).toString(16).toUpperCase().padStart(4,"0");
}
function genCalendarUrl(event, time, name, bodyPart) {
  if (!event.date) return null;
  const [y,m,d] = event.date.split("-");
  const [hh,mm] = time.split(":");
  const pad = n => String(n).padStart(2,"0");
  const start = `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;
  const endH = String(parseInt(hh)+(parseInt(mm)+60>=60?1:0)).padStart(2,"0");
  const endM = String((parseInt(mm)+60)%60).padStart(2,"0");
  const end = `${y}${pad(m)}${pad(d)}T${endH}${endM}00`;
  const details = encodeURIComponent(["Nome: "+name, bodyPart?"Tatuagem: "+bodyPart:"", "Ink Station Flash Day"].filter(Boolean).join("\n"));
  return "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    "&text=" + encodeURIComponent(event.name) +
    "&dates=" + start + "/" + end +
    "&location=" + encodeURIComponent(event.location) +
    "&details=" + details;
}

const INIT_EVENT = { name:"Flash Day Ink Station", date:"2026-04-04", location:"Sao Bernardo do Campo, SP", startTime:"10:00", endTime:"20:00", interval:30, capacity:3 };
const INIT_SLOTS = genSlots("10:00","20:00",30);
const INIT_BOOKINGS = [];
const INIT_PIX = { key:"", keyType:"cpf", holderName:"", bank:"" };
const INIT_DONATIONS = []; // { id, tipo:"cliente"|"doacao", nome, caixas, data, obs, bookingId? }

function Chip({ status }) {
  const cfg = {
    available:{ label:"Disponivel",  bg:T.greenDim, clr:T.green },
    last:     { label:"Ultima vaga", bg:T.amberDim, clr:T.amber },
    full:     { label:"Lotado",      bg:T.redDim,   clr:T.red   },
    blocked:  { label:"Bloqueado",   bg:T.grayDim,  clr:T.gray  },
  }[status]||{};
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, background:cfg.bg, color:cfg.clr, borderRadius:100, padding:"3px 10px", fontSize:11, fontWeight:600, letterSpacing:"0.04em" }}>
      <span style={{ width:5, height:5, borderRadius:"50%", background:cfg.clr }} />{cfg.label}
    </span>
  );
}

function BChip({ status }) {
  const cfg = { pending:{bg:"#1c1400",clr:T.amber}, confirmed:{bg:"#0d2618",clr:T.green}, done:{bg:"#0d1826",clr:"#60a5fa"}, cancelled:{bg:"#200c0c",clr:T.red} }[status]||{};
  return <span style={{ background:cfg.bg, color:cfg.clr, borderRadius:100, padding:"2px 9px", fontSize:11, fontWeight:600 }}>{STATUS_LABELS[status]||status}</span>;
}

function Dots({ count, cap }) {
  return (
    <div style={{ display:"flex", gap:4 }}>
      {Array.from({length:cap}).map((_,i) => (
        <span key={i} style={{ width:7, height:7, borderRadius:"50%", background:i<count?T.accent:T.surface3, border:`1px solid ${i<count?T.accent:T.border2}` }} />
      ))}
    </div>
  );
}

function Overlay({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.82)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:T.surface, borderRadius:16, padding:"24px 20px 32px", width:"100%", maxWidth:520, maxHeight:"90vh", overflowY:"auto" }}>
        <div onClick={onClose} style={{ width:32, height:3, background:T.border2, borderRadius:2, margin:"0 auto 20px", cursor:"pointer" }} />
        {children}
      </div>
    </div>
  );
}

function LoginScreen({ loginPwd, setLoginPwd, loginErr, setLoginErr, onLogin }) {
  return (
    <div style={{ minHeight:"80vh", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:16, padding:"36px 28px", width:"100%", maxWidth:360 }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, letterSpacing:"0.12em", color:T.accent, marginBottom:4 }}>INK STATION</div>
          <div style={{ fontSize:13, color:T.textMuted }}>Acesso restrito ao painel admin</div>
        </div>
        <div style={{ marginBottom:14 }}>
          <label style={lbl}>Senha</label>
          <input type="password" placeholder="Digite a senha..." value={loginPwd} autoFocus
            onChange={e=>{ setLoginPwd(e.target.value); setLoginErr(false); }}
            onKeyDown={e=>e.key==="Enter"&&onLogin()}
            style={{ ...inp, borderColor:loginErr?T.red:T.border2 }} />
          {loginErr && <div style={{ fontSize:12, color:T.red, marginTop:6 }}>Senha incorreta. Tente novamente.</div>}
        </div>
        <button onClick={onLogin} style={{ ...btnP, width:"100%", marginTop:4 }}>Entrar</button>
        <div style={{ textAlign:"center", marginTop:16, fontSize:11, color:T.textDim }}>
          Senha padrao: <span style={{ color:T.textMuted, fontFamily:"monospace" }}>inkstation2026</span>
        </div>
      </div>
    </div>
  );
}

function QRCodeCanvas({ text, size=180 }) {
  useEffect(()=>{
    const loadAndRender = ()=>{
      if (!window.QRCode) {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
        s.onload = render;
        document.head.appendChild(s);
      } else render();
    };
    const render = ()=>{
      const el = document.getElementById("qr-canvas-" + size);
      if (!el) return;
      el.innerHTML = "";
      new window.QRCode(el, { text, width:size, height:size, colorDark:"#111111", colorLight:"#ffffff" });
    };
    loadAndRender();
  },[text, size]);
  return <div id={"qr-canvas-" + size} />;
}


function useCountdown(targetDate) {
  const calc = () => {
    if (!targetDate) return null;
    const diff = new Date(targetDate+"T00:00:00").getTime() - Date.now();
    if (diff <= 0) return { days:0, hours:0, minutes:0, seconds:0, done:true };
    return {
      days:    Math.floor(diff/(1000*60*60*24)),
      hours:   Math.floor((diff/(1000*60*60))%24),
      minutes: Math.floor((diff/(1000*60))%60),
      seconds: Math.floor((diff/1000)%60),
      done:    false,
    };
  };
  const [cd, setCd] = useState(calc);
  useEffect(()=>{ const t=setInterval(()=>setCd(calc()),1000); return ()=>clearInterval(t); },[targetDate]);
  return cd;
}

function AgendaView({ event, slots, slotStats, getStatus, onBook, flashLink }) {
  const totalActive = Object.values(slotStats).reduce((a,s)=>a+s.count,0);
  const freeSlots   = slots.filter(s=>!s.blocked).reduce((a,s)=>a+Math.max(0,event.capacity-(slotStats[s.id]?.count??0)),0);
  const weekday     = event.date ? new Date(event.date+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"long"}) : "";
  const countdown   = useCountdown(event.date);
  return (
    <div style={{ minHeight:"100vh", paddingBottom:60 }}>
      <div style={{ background:"linear-gradient(180deg,#1c0406 0%,#080808 100%)", padding:"44px 20px 36px", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ maxWidth:560, margin:"0 auto", textAlign:"center" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:10 }}>
            <span style={{ width:24, height:1, background:T.accent }} />
            <span style={{ fontSize:10, color:T.accent, letterSpacing:"0.25em", fontWeight:600, textTransform:"uppercase" }}>Evento Especial</span>
            <span style={{ width:24, height:1, background:T.accent }} />
          </div>
          <h1 style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:"clamp(40px,10vw,72px)", margin:"0 0 4px", letterSpacing:"0.04em", lineHeight:1 }}>{event.name}</h1>
          <div style={{ fontSize:14, color:T.textMuted, marginTop:12, display:"flex", justifyContent:"center", gap:20, flexWrap:"wrap" }}>
            <span>Data: {fmtDate(event.date)}{weekday?` - ${weekday}`:""}</span>
            <span>Local: {event.location}</span>
          </div>
          {countdown && !countdown.done && (
            <div style={{ marginTop:18, display:"flex", justifyContent:"center", gap:8 }}>
              {[{v:countdown.days,l:"dias"},{v:countdown.hours,l:"horas"},{v:countdown.minutes,l:"min"},{v:countdown.seconds,l:"seg"}].map(u=>(
                <div key={u.l} style={{ background:"rgba(0,0,0,0.4)", border:`1px solid ${T.accent}30`, borderRadius:10, padding:"10px 14px", textAlign:"center", minWidth:52 }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color:T.accent, letterSpacing:"0.04em", lineHeight:1 }}>{String(u.v).padStart(2,"0")}</div>
                  <div style={{ fontSize:9, color:T.textMuted, letterSpacing:"0.12em", textTransform:"uppercase", marginTop:2 }}>{u.l}</div>
                </div>
              ))}
            </div>
          )}
          {countdown && countdown.done && (
            <div style={{ marginTop:14, fontSize:13, color:T.accent, fontWeight:600, letterSpacing:"0.08em" }}>O EVENTO ESTA ACONTECENDO AGORA!</div>
          )}
          <div style={{ marginTop:20, display:"flex", justifyContent:"center", gap:10 }}>
            {[{v:totalActive,l:"Agendados",clr:T.text},{v:freeSlots,l:"Vagas livres",clr:T.green}].map(s=>(
              <div key={s.l} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 22px", textAlign:"center", minWidth:90 }}>
                <div style={{ fontSize:26, fontWeight:700, color:s.clr, fontFamily:"'Bebas Neue',sans-serif", letterSpacing:"0.04em" }}>{s.v}</div>
                <div style={{ fontSize:10, color:T.textMuted, letterSpacing:"0.07em", textTransform:"uppercase" }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {flashLink && (
        <div style={{ maxWidth:580, margin:"0 auto", padding:"16px 14px 0" }}>
          <a href={flashLink} target="_blank" rel="noopener noreferrer"
            style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, background:T.accentDim, border:`1px solid ${T.accent}40`, borderRadius:10, padding:"13px 20px", color:T.accent, fontSize:14, fontWeight:600, textDecoration:"none", letterSpacing:"0.03em" }}>
            <span style={{ fontSize:18 }}>🖼</span>
            Ver catálogo de designs Flash Day
            <span style={{ fontSize:12, opacity:0.7 }}>↗</span>
          </a>
        </div>
      )}
      <div style={{ display:"flex", justifyContent:"center", gap:8, padding:"14px 20px", flexWrap:"wrap" }}>
        {["available","last","full","blocked"].map(s=><Chip key={s} status={s} />)}
      </div>
      <div style={{ maxWidth:580, margin:"0 auto", padding:"0 14px" }}>
        {slots.map(slot=>{
          const status=getStatus(slot);
          const count=slotStats[slot.id]?.count??0;
          const canBook=status==="available"||status==="last";
          return (
            <div key={slot.id} style={{ background:T.surface, border:`1px solid ${T.border}`, borderLeft:`3px solid ${{available:T.green,last:T.amber,full:T.red,blocked:T.gray}[status]}`, borderRadius:10, padding:"14px 18px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, opacity:status==="blocked"?.45:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                <div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:32, letterSpacing:"0.05em", lineHeight:1, color:T.text }}>{slot.time}</div>
                  <Dots count={count} cap={event.capacity} />
                </div>
                <div>
                  <Chip status={status} />
                  <div style={{ fontSize:11, color:T.textDim, marginTop:5 }}>
                    {status!=="blocked" ? `${Math.max(0,event.capacity-count)} vaga${event.capacity-count!==1?"s":""} restante${event.capacity-count!==1?"s":""}` : "Horario indisponivel"}
                  </div>
                </div>
              </div>
              {canBook && <button onClick={()=>onBook({slotId:slot.id,time:slot.time})} style={{ ...btnP, padding:"8px 16px", fontSize:13, flexShrink:0 }}>Agendar</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BookingsTab({ gStats, filteredBookings, slots, search, setSearch, filterSt, setFilterSt, sortBy, setSortBy, onEdit, onConfirm, onConcluir, onReminder, onDelete }) {
  return (
    <div style={{ maxWidth:820, margin:"0 auto", padding:"24px 16px" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:10 }}>
        {[{l:"Ag. sinal",clr:T.amber,v:gStats.pending},{l:"Confirmados",clr:T.green,v:gStats.confirmed},{l:"Realizados",clr:"#60a5fa",v:gStats.done},{l:"Cancelados",clr:T.red,v:gStats.cancelled}].map(s=>(
          <div key={s.l} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"14px 16px" }}>
            <div style={{ fontSize:28, fontWeight:700, color:s.clr, fontFamily:"'Bebas Neue',sans-serif", letterSpacing:"0.04em" }}>{s.v}</div>
            <div style={{ fontSize:10, color:T.textMuted, letterSpacing:"0.08em", textTransform:"uppercase" }}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:22 }}>
        <div style={{ background:"#0d1a0d", border:`1px solid ${T.greenDim}`, borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:11, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.07em" }}>Sinais arrecadados</div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:T.green, letterSpacing:"0.04em" }}>R$ {gStats.totalSinais}</div>
        </div>
        <div style={{ background:"#0a1a2e", border:"1px solid #60a5fa20", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:11, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.07em" }}>Faturado em sessoes</div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#60a5fa", letterSpacing:"0.04em" }}>R$ {gStats.totalSessoes}</div>
        </div>
      </div>
      <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        <input placeholder="Buscar por nome ou telefone..." value={search} onChange={e=>setSearch(e.target.value)} style={{ ...inp, flex:1, minWidth:180 }} />
        <select value={filterSt} onChange={e=>setFilterSt(e.target.value)} style={{ ...inp, width:"auto", paddingRight:32 }}>
          <option value="all">Todos os status</option>
          <option value="pending">Aguardando sinal</option>
          <option value="confirmed">Confirmados</option>
          <option value="done">Realizados</option>
          <option value="cancelled">Cancelados</option>
        </select>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ ...inp, width:"auto", paddingRight:32 }}>
          <option value="time">Por horário</option>
          <option value="newest">Mais recente</option>
          <option value="oldest">Mais antigo</option>
        </select>
      </div>
      {filteredBookings.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:"48px 0", fontSize:14 }}>Nenhum agendamento encontrado.</div>}
      {filteredBookings.map(b=>{
        const slot=slots.find(s=>s.id===b.slotId);
        return (
          <div key={b.id} style={{ background:T.surface, border:`1px solid ${b.status==="pending"?T.amber:T.border}`, borderRadius:10, padding:"14px 16px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
            <div onClick={()=>onEdit(b)} style={{ minWidth:0, flex:1, cursor:"pointer" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                <span style={{ fontWeight:600, fontSize:14, color:T.text }}>{b.name}</span>
                <BChip status={b.status} />
              </div>
              <div style={{ fontSize:12, color:T.textMuted, display:"flex", gap:12, flexWrap:"wrap" }}>
                <span>{b.phone}</span>
                {slot && <span style={{ color:T.accent }}>Hora: {slot.time}</span>}
                {b.bodyPart && <span style={{ color:T.textMuted }}>Local: {b.bodyPart}</span>}
                {b.caixas>0 && <span style={{ color:"#f97316" }}>Caixas: {b.caixas}</span>}
              </div>
              {b.notes && <div style={{ fontSize:12, color:T.textDim, marginTop:3, fontStyle:"italic" }}>"{b.notes}"</div>}
              {b.sessao && (
                <div style={{ display:"flex", gap:10, marginTop:4, flexWrap:"wrap" }}>
                  {b.sessao.valorCobrado && <span style={{ fontSize:11, background:"#0d2618", color:T.green, borderRadius:100, padding:"2px 8px" }}>R$ {b.sessao.valorCobrado}</span>}
                  {b.sessao.duracao && <span style={{ fontSize:11, background:T.surface3, color:T.textMuted, borderRadius:100, padding:"2px 8px" }}>{b.sessao.duracao} min</span>}
                  {b.sessao.agulhas && <span style={{ fontSize:11, background:T.surface3, color:T.textMuted, borderRadius:100, padding:"2px 8px" }}>Agulhas: {b.sessao.agulhas}</span>}
                  {b.sessao.tintas && <span style={{ fontSize:11, background:T.surface3, color:T.textMuted, borderRadius:100, padding:"2px 8px" }}>Tintas: {b.sessao.tintas}</span>}
                </div>
              )}
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexShrink:0 }}>
              {b.status==="pending" && (
                <button onClick={e=>{ e.stopPropagation(); onConfirm(b.id); }} style={{ background:"#0d2618", color:T.green, border:`1px solid ${T.green}`, borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap" }}>
                  Confirmar sinal
                </button>
              )}
              {b.status==="confirmed" && (<>
                <button onClick={e=>{ e.stopPropagation(); onReminder(b); }} style={{ background:"#0d1a0d", color:T.green, border:`1px solid ${T.greenDim}`, borderRadius:8, padding:"7px 12px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap" }}>
                  Lembrete
                </button>
                <button onClick={e=>{ e.stopPropagation(); onConcluir(b); }} style={{ background:"#0a1a2e", color:"#60a5fa", border:"1px solid #60a5fa30", borderRadius:8, padding:"7px 12px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap" }}>
                  Concluir
                </button>
              </>)}
              {b.status==="cancelled" && (
                <button onClick={e=>{ e.stopPropagation(); if(window.confirm("Excluir agendamento de " + b.name + "?")) onDelete(b.id); }} style={{ background:"#200c0c", color:T.red, border:`1px solid ${T.redDim}`, borderRadius:8, padding:"7px 12px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap" }}>
                  Excluir
                </button>
              )}
              <span onClick={()=>onEdit(b)} style={{ color:T.textDim, fontSize:18, cursor:"pointer", padding:"0 4px" }}>&#8250;</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SlotsTab({ slots, setSlots, slotStats, event, getStatus }) {
  return (
    <div style={{ maxWidth:700, margin:"0 auto", padding:"24px 16px" }}>
      {slots.map(slot=>{
        const status=getStatus(slot);
        const list=slotStats[slot.id]?.list??[];
        return (
          <div key={slot.id} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, marginBottom:10, overflow:"hidden" }}>
            <div style={{ padding:"14px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:26, color:T.text, letterSpacing:"0.05em" }}>{slot.time}</span>
                <Chip status={status} />
                <span style={{ fontSize:12, color:T.textDim }}>{slotStats[slot.id]?.count??0}/{event.capacity}</span>
              </div>
              <button onClick={async ()=>{ await supabase.from("slots").update({blocked:!slot.blocked}).eq("id",slot.id); setSlots(p=>p.map(s=>s.id===slot.id?{...s,blocked:!s.blocked}:s)); }} style={{ background:slot.blocked?T.accentDim:T.surface3, color:slot.blocked?T.accent:T.textMuted, border:`1px solid ${slot.blocked?T.accent:T.border2}`, borderRadius:6, padding:"6px 14px", fontSize:12, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:500 }}>
                {slot.blocked?"Desbloquear":"Bloquear"}
              </button>
            </div>
            {list.length>0 && (
              <div style={{ borderTop:`1px solid ${T.border}`, padding:"10px 16px", display:"flex", flexDirection:"column", gap:5 }}>
                {list.map(b=>(
                  <div key={b.id} style={{ fontSize:12, color:T.textMuted, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <span style={{ width:5, height:5, borderRadius:"50%", background:T.accent, flexShrink:0 }} />
                    <span style={{ color:T.text, fontWeight:500 }}>{b.name}</span>
                    <span>{b.phone}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SettingsTab({ settingsForm, setSettingsForm, pwdForm, setPwdForm, pwdErr, setPwdErr, onSaveEvent, onSavePwd, pixConfig, onSavePix, flashLink, onSaveFlashLink, savedTemplate, onSaveTemplate, onLoadTemplate }) {
  const [localFlashLink, setLocalFlashLink] = useState(flashLink);
  const [pix, setPix] = useState({...pixConfig});
  const preview = useMemo(()=>genSlots(settingsForm.startTime,settingsForm.endTime,settingsForm.interval),[settingsForm.startTime,settingsForm.endTime,settingsForm.interval]);
  return (
    <div style={{ maxWidth:580, margin:"0 auto", padding:"24px 16px" }}>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:24, marginBottom:16 }}>
        {[{k:"name",label:"Nome do evento",type:"text"},{k:"date",label:"Data",type:"date"},{k:"location",label:"Local",type:"text"}].map(f=>(
          <div key={f.k} style={{ marginBottom:16 }}>
            <label style={lbl}>{f.label}</label>
            <input type={f.type} value={settingsForm[f.k]??""} onChange={e=>setSettingsForm(p=>({...p,[f.k]:e.target.value}))} style={inp} />
          </div>
        ))}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
          {[{k:"startTime",label:"Inicio",type:"time"},{k:"endTime",label:"Termino",type:"time"}].map(f=>(
            <div key={f.k}>
              <label style={lbl}>{f.label}</label>
              <input type={f.type} value={settingsForm[f.k]??""} onChange={e=>setSettingsForm(p=>({...p,[f.k]:e.target.value}))} style={inp} />
            </div>
          ))}
        </div>
        <div style={{ marginBottom:16 }}>
          <label style={lbl}>Intervalo entre horarios</label>
          <select value={settingsForm.interval} onChange={e=>setSettingsForm(p=>({...p,interval:parseInt(e.target.value)}))} style={inp}>
            {[15,20,30,45,60,90,120].map(v=><option key={v} value={v}>{v===60?"1 hora":v===90?"1h 30min":v===120?"2 horas":`${v} min`}</option>)}
          </select>
        </div>
        <div style={{ marginBottom:22 }}>
          <label style={lbl}>Vagas por horario</label>
          <select value={settingsForm.capacity} onChange={e=>setSettingsForm(p=>({...p,capacity:parseInt(e.target.value)}))} style={inp}>
            {[1,2,3,4,5,6].map(v=><option key={v} value={v}>{v} vaga{v>1?"s":""}</option>)}
          </select>
        </div>
        <div style={{ background:T.surface3, border:`1px solid ${T.border}`, borderRadius:8, padding:14, marginBottom:16 }}>
          <div style={{ fontSize:10, color:T.textMuted, letterSpacing:"0.08em", marginBottom:8, textTransform:"uppercase" }}>Preview - {preview.length} horarios gerados</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {preview.map(s=><span key={s.id} style={{ background:T.surface2, border:`1px solid ${T.border2}`, borderRadius:6, padding:"3px 9px", fontSize:12, color:T.textMuted }}>{s.time}</span>)}
          </div>
        </div>
        <div style={{ background:"#0d1a0d", border:`1px solid ${T.greenDim}`, borderRadius:8, padding:"10px 14px", marginBottom:20, fontSize:12, color:T.green }}>
          Novos horarios serao adicionados. Agendamentos, doacoes e faturamento existentes sao preservados.
        </div>
        <button onClick={onSaveEvent} style={{ ...btnP, width:"100%" }}>Salvar Configuracoes</button>
        <div style={{ display:"flex", gap:10, marginTop:12 }}>
          <button onClick={onSaveTemplate} style={{ ...btnS, flex:1, fontSize:12, padding:"8px 14px" }}>Salvar como template</button>
          <button onClick={onLoadTemplate} disabled={!savedTemplate} style={{ ...btnS, flex:1, fontSize:12, padding:"8px 14px", opacity:savedTemplate?1:0.4, cursor:savedTemplate?"pointer":"not-allowed" }}>
            {savedTemplate ? "Carregar template" : "Nenhum template"}
          </button>
        </div>
      </div>

      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:24, marginBottom:16 }}>
        <div style={{ fontSize:12, color:T.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:18 }}>Catalogo de Designs (Flash)</div>
        <div style={{ marginBottom:12 }}>
          <label style={lbl}>Link do catalogo (Google Drive, Notion, etc.)</label>
          <input type="url" placeholder="https://drive.google.com/..." value={localFlashLink} onChange={e=>setLocalFlashLink(e.target.value)} style={inp} />
        </div>
        {localFlashLink && (
          <div style={{ fontSize:12, color:T.textMuted, marginBottom:14, wordBreak:"break-all" }}>
            Previa: <a href={localFlashLink} target="_blank" rel="noopener noreferrer" style={{ color:T.accent }}>abrir link</a>
          </div>
        )}
        <button onClick={()=>onSaveFlashLink(localFlashLink)} style={{ ...btnP, width:"100%" }}>Salvar link dos designs</button>
      </div>

      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:24, marginBottom:16 }}>
        <div style={{ fontSize:12, color:T.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:18 }}>Dados para Pagamento (Pix)</div>
        <div style={{ marginBottom:14 }}>
          <label style={lbl}>Tipo de chave</label>
          <select value={pix.keyType} onChange={e=>setPix(p=>({...p,keyType:e.target.value}))} style={inp}>
            <option value="cpf">CPF</option>
            <option value="cnpj">CNPJ</option>
            <option value="phone">Telefone</option>
            <option value="email">E-mail</option>
            <option value="random">Chave aleatoria</option>
          </select>
        </div>
        <div style={{ marginBottom:14 }}>
          <label style={lbl}>Chave Pix</label>
          <input type="text" placeholder="Ex: 11999999999 ou seu@email.com" value={pix.key} onChange={e=>setPix(p=>({...p,key:e.target.value}))} style={inp} />
        </div>
        <div style={{ marginBottom:14 }}>
          <label style={lbl}>Nome do favorecido</label>
          <input type="text" placeholder="Nome completo ou razao social" value={pix.holderName} onChange={e=>setPix(p=>({...p,holderName:e.target.value}))} style={inp} />
        </div>
        <div style={{ marginBottom:20 }}>
          <label style={lbl}>Banco</label>
          <input type="text" placeholder="Ex: Nubank, Itau, Bradesco..." value={pix.bank} onChange={e=>setPix(p=>({...p,bank:e.target.value}))} style={inp} />
        </div>
        {pix.key && (
          <div style={{ background:T.surface3, border:`1px solid ${T.border}`, borderRadius:8, padding:"12px 14px", marginBottom:16, fontSize:12, color:T.textMuted }}>
            <div style={{ marginBottom:4 }}>Preview para o cliente:</div>
            <div style={{ color:T.text, fontWeight:500 }}>{pix.key}</div>
            {pix.holderName && <div style={{ marginTop:2 }}>Favorecido: {pix.holderName}</div>}
            {pix.bank && <div>Banco: {pix.bank}</div>}
          </div>
        )}
        <button onClick={()=>onSavePix(pix)} style={{ ...btnP, width:"100%" }}>Salvar dados Pix</button>
      </div>

      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:24 }}>
        <div style={{ fontSize:12, color:T.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:18 }}>Alterar Senha de Admin</div>
        {[{k:"current",label:"Senha atual",ph:"Digite a senha atual"},{k:"newPwd",label:"Nova senha",ph:"Minimo 6 caracteres"},{k:"confirm",label:"Confirmar nova senha",ph:"Repita a nova senha"}].map(f=>(
          <div key={f.k} style={{ marginBottom:12 }}>
            <label style={lbl}>{f.label}</label>
            <input type="password" placeholder={f.ph} value={pwdForm[f.k]} onChange={e=>{setPwdForm(p=>({...p,[f.k]:e.target.value}));setPwdErr("");}} style={inp} />
          </div>
        ))}
        {pwdErr && <div style={{ fontSize:12, color:T.red, marginBottom:10 }}>{pwdErr}</div>}
        <button onClick={onSavePwd} style={{ ...btnP, width:"100%", marginTop:4 }}>Alterar Senha</button>
      </div>
    </div>
  );
}

function BookModal({ bookModal, bookForm, setBookForm, bookStep, onBook, onClose, pixConfig, event, isSubmitting }) {
  if (!bookModal) return null;
  const maxDob = new Date(new Date().setFullYear(new Date().getFullYear()-18)).toISOString().split("T")[0];
  return (
    <Overlay onClose={onClose}>
      {bookStep==="form" ? (
        <>
          <div style={{ marginBottom:18 }}>
            <div style={{ fontSize:10, color:T.accent, letterSpacing:"0.18em", marginBottom:4, textTransform:"uppercase" }}>Agendar horario</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:38, letterSpacing:"0.05em", lineHeight:1 }}>{bookModal.time}</div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={lbl}>Nome completo *</label>
            <input type="text" placeholder="Seu nome" value={bookForm.name} onChange={e=>setBookForm(p=>({...p,name:e.target.value}))} style={inp} />
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={lbl}>Telefone / WhatsApp *</label>
            <input type="tel" placeholder="(11) 99999-9999" value={bookForm.phone} onChange={e=>setBookForm(p=>({...p,phone:fmtPhone(e.target.value)}))} style={inp} />
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={lbl}>Data de nascimento * (necessario ter 18+)</label>
            <input type="date" value={bookForm.dob} max={maxDob} onChange={e=>setBookForm(p=>({...p,dob:e.target.value}))} style={inp} />
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={lbl}>Parte do corpo</label>
            <select value={bookForm.bodyPart} onChange={e=>setBookForm(p=>({...p,bodyPart:e.target.value}))} style={inp}>
              <option value="">Selecione...</option>
              <option value="Braco (superior)">Braco (superior)</option>
              <option value="Braco (inferior / antebrace)">Braco (inferior / antebrace)</option>
              <option value="Punho / mao">Punho / mao</option>
              <option value="Perna (superior / coxa)">Perna (superior / coxa)</option>
              <option value="Perna (inferior / panturrilha)">Perna (inferior / panturrilha)</option>
              <option value="Pe / tornozelo">Pe / tornozelo</option>
              <option value="Peito / clavícula">Peito / clavicula</option>
              <option value="Costas">Costas</option>
              <option value="Costela / lateral">Costela / lateral</option>
              <option value="Pescoco">Pescoco</option>
              <option value="Cabeca">Cabeca</option>
              <option value="Outro">Outro</option>
            </select>
          </div>
          <div style={{ marginBottom:18 }}>
            <label style={lbl}>Caixas de bombom (Lacta ou Nestle)</label>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
              {[{v:0,label:"Nenhuma",sub:""},{v:1,label:"1 caixa",sub:"2o flash ate R$150"},{v:2,label:"2 caixas",sub:"2o flash ate R$300"}].map(opt=>(
                <button key={opt.v} type="button" onClick={()=>setBookForm(p=>({...p,caixas:opt.v}))} style={{
                  background:bookForm.caixas===opt.v?"#1a0e00":T.surface3,
                  border:`1px solid ${bookForm.caixas===opt.v?"#f97316":T.border2}`,
                  borderRadius:8, padding:"10px 8px", cursor:"pointer", textAlign:"center",
                  fontFamily:"'DM Sans',sans-serif",
                }}>
                  <div style={{ fontSize:13, fontWeight:600, color:bookForm.caixas===opt.v?"#f97316":T.text }}>{opt.label}</div>
                  {opt.sub && <div style={{ fontSize:10, color:bookForm.caixas===opt.v?"#f97316":T.textDim, marginTop:3 }}>{opt.sub}</div>}
                </button>
              ))}
            </div>
            {bookForm.caixas>0 && (
              <div style={{ marginTop:10, background:"#1a0e00", border:"1px solid #f9731630", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#f97316" }}>
                Trazendo {bookForm.caixas} caixa{bookForm.caixas>1?"s":""} de bombom voce ganha um 2o flash de ate R${bookForm.caixas===1?150:300}!
              </div>
            )}
          </div>
          <div style={{ marginBottom:20 }}>
            <label style={lbl}>Numero do arquivo do design</label>
            <textarea placeholder="Ex: arquivo 03, foto 07... consulte o catalogo de designs!" value={bookForm.notes} onChange={e=>setBookForm(p=>({...p,notes:e.target.value}))} style={{ ...inp, height:72, resize:"vertical" }} />
          </div>
          <div style={{ background:"#0d1a0d", border:`1px solid #22c55e28`, borderRadius:10, padding:"14px 16px", marginBottom:20 }}>
            <div style={{ fontSize:12, fontWeight:600, color:T.green, marginBottom:6 }}>Confirmacao por sinal</div>
            <div style={{ fontSize:12, color:"#86efac", lineHeight:1.6 }}>
              Para confirmar seu agendamento e necessario o pagamento de um sinal de R$ {SINAL_VALOR}. O valor restante e pago no dia do evento.
            </div>
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={onClose} style={{ ...btnS, flex:1 }}>Cancelar</button>
            <button onClick={onBook} disabled={isSubmitting} style={{ ...btnP, flex:2, opacity:isSubmitting?0.6:1, cursor:isSubmitting?"not-allowed":"pointer" }}>{isSubmitting?"Salvando...":"Agendar"}</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <div style={{ fontSize:36, marginBottom:10 }}>:)</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color:T.green, letterSpacing:"0.05em", marginBottom:6 }}>Quase la, {bookForm.name.split(" ")[0]}!</div>
            <div style={{ fontSize:13, color:T.textMuted, lineHeight:1.6 }}>
              Seu horario das <strong style={{ color:T.text }}>{bookModal.time}</strong> esta reservado. Conclua o pagamento do sinal para confirmar.
            </div>
          </div>
          <div style={{ background:T.surface3, border:`1px solid ${T.border2}`, borderRadius:12, padding:"18px 16px", marginBottom:20 }}>
            <div style={{ fontSize:10, color:T.textMuted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:14 }}>Pagamento do sinal</div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <span style={{ fontSize:13, color:T.textMuted }}>Valor</span>
              <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color:T.green, letterSpacing:"0.04em" }}>R$ {SINAL_VALOR},00</span>
            </div>
            {pixConfig && pixConfig.key ? (() => {
              const pixPayload = genPixPayload(pixConfig, SINAL_VALOR);
              return (
                <>
                  {pixPayload && (
                    <div style={{ textAlign:"center", marginBottom:16 }}>
                      <div style={{ background:"#fff", borderRadius:10, padding:14, display:"inline-block" }}>
                        <QRCodeCanvas text={pixPayload} size={180} />
                      </div>
                      <div style={{ fontSize:11, color:T.textMuted, marginTop:8 }}>Abra o app do banco e escaneie o QR code Pix</div>
                    </div>
                  )}
                  <div style={{ background:T.surface2, borderRadius:8, padding:"12px 14px" }}>
                    <div style={{ fontSize:11, color:T.textDim, marginBottom:6, textTransform:"uppercase", letterSpacing:"0.07em" }}>Ou copie a chave Pix ({pixConfig.keyType})</div>
                    <div style={{ fontSize:15, color:T.text, fontWeight:700, letterSpacing:"0.02em", marginBottom:6, wordBreak:"break-all" }}>{pixConfig.key}</div>
                    {pixConfig.holderName && <div style={{ fontSize:12, color:T.textMuted }}>Favorecido: <span style={{ color:T.text, fontWeight:500 }}>{pixConfig.holderName}</span></div>}
                    {pixConfig.bank && <div style={{ fontSize:12, color:T.textMuted, marginTop:2 }}>Banco: <span style={{ color:T.text, fontWeight:500 }}>{pixConfig.bank}</span></div>}
                  </div>
                </>
              );
            })() : (
              <div style={{ background:T.surface2, borderRadius:8, padding:"12px 14px" }}>
                <div style={{ fontSize:14, color:T.text, fontWeight:500 }}>Entre em contato pelo WhatsApp para receber a chave Pix e finalizar a confirmacao.</div>
              </div>
            )}
          </div>
          <div style={{ background:"#1e1400", border:`1px solid ${T.amberDim}`, borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:12, color:T.amber, lineHeight:1.6 }}>
            O agendamento ficara como Aguardando sinal ate a confirmacao do pagamento pela equipe.
          </div>
          {genCalendarUrl(event, bookModal.time, bookForm.name, bookForm.bodyPart) && (
            <a href={genCalendarUrl(event, bookModal.time, bookForm.name, bookForm.bodyPart)} target="_blank" rel="noopener noreferrer"
              style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, background:"#0d1a2e", border:`1px solid #3b82f680`, borderRadius:10, padding:"14px 18px", color:"#60a5fa", fontSize:14, fontWeight:600, textDecoration:"none", marginBottom:16, letterSpacing:"0.02em" }}>
              <span style={{ fontSize:20 }}>📅</span>
              <div>
                <div>Salvar na agenda</div>
                <div style={{ fontSize:11, fontWeight:400, color:"#93c5fd", marginTop:2 }}>Adicionar ao Google Calendar</div>
              </div>
              <span style={{ marginLeft:"auto", fontSize:16, opacity:0.7 }}>↗</span>
            </a>
          )}
          <button onClick={onClose} style={{ ...btnP, width:"100%" }}>Entendido, vou pagar o sinal</button>
        </>
      )}
    </Overlay>
  );
}

function EditModal({ editModal, setEditModal, slots, onSave, onRequestCancel }) {
  if (!editModal) return null;
  const slot = slots.find(s=>s.id===editModal.slotId);
  return (
    <Overlay onClose={()=>setEditModal(null)}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
        <div>
          <div style={{ fontSize:10, color:T.accent, letterSpacing:"0.18em", marginBottom:4, textTransform:"uppercase" }}>Editar agendamento</div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:30 }}>{editModal.name}</div>
          {slot && <div style={{ fontSize:12, color:T.textMuted, marginTop:2 }}>Hora: {slot.time}</div>}
        </div>
        <BChip status={editModal.status} />
      </div>
      {[{k:"name",label:"Nome",type:"text"},{k:"phone",label:"Telefone",type:"tel"},{k:"dob",label:"Data de nascimento",type:"date"}].map(f=>(
        <div key={f.k} style={{ marginBottom:12 }}>
          <label style={lbl}>{f.label}</label>
          <input type={f.type} value={editModal[f.k]||""} onChange={e=>setEditModal(m=>({...m,[f.k]:e.target.value}))} style={inp} />
        </div>
      ))}
      <div style={{ marginBottom:12 }}>
        <label style={lbl}>Parte do corpo</label>
        <select value={editModal.bodyPart||""} onChange={e=>setEditModal(m=>({...m,bodyPart:e.target.value}))} style={inp}>
          <option value="">Nao informado</option>
          <option value="Braco (superior)">Braco (superior)</option>
          <option value="Braco (inferior / antebrace)">Braco (inferior / antebrace)</option>
          <option value="Punho / mao">Punho / mao</option>
          <option value="Perna (superior / coxa)">Perna (superior / coxa)</option>
          <option value="Perna (inferior / panturrilha)">Perna (inferior / panturrilha)</option>
          <option value="Pe / tornozelo">Pe / tornozelo</option>
          <option value="Peito / clavicula">Peito / clavicula</option>
          <option value="Costas">Costas</option>
          <option value="Costela / lateral">Costela / lateral</option>
          <option value="Pescoco">Pescoco</option>
          <option value="Cabeca">Cabeca</option>
          <option value="Outro">Outro</option>
        </select>
      </div>
      <div style={{ marginBottom:12 }}>
        <label style={lbl}>Status</label>
        <select value={editModal.status} onChange={e=>setEditModal(m=>({...m,status:e.target.value}))} style={inp}>
          <option value="pending">Aguardando sinal</option>
          <option value="confirmed">Confirmado</option>
          <option value="done">Realizado</option>
          <option value="cancelled">Cancelado</option>
        </select>
      </div>
      <div style={{ marginBottom:22 }}>
        <label style={lbl}>Observacoes</label>
        <textarea value={editModal.notes||""} onChange={e=>setEditModal(m=>({...m,notes:e.target.value}))} style={{ ...inp, height:68, resize:"vertical" }} />
      </div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <button onClick={onRequestCancel} style={{ ...btnD, flex:"1 1 120px" }}>Cancelar ag.</button>
        <button onClick={()=>setEditModal(null)} style={{ ...btnS, flex:"1 1 80px" }}>Fechar</button>
        <button onClick={onSave} style={{ ...btnP, flex:"2 1 140px" }}>Salvar</button>
      </div>
    </Overlay>
  );
}


function ResumoTab({ bookings, donations, slots, event }) {
  const done      = bookings.filter(b=>b.status==="done");
  const confirmed = bookings.filter(b=>b.status==="confirmed");
  const pending   = bookings.filter(b=>b.status==="pending");
  const cancelled = bookings.filter(b=>b.status==="cancelled");
  const totalSinais   = bookings.filter(b=>b.status!=="cancelled").length * SINAL_VALOR;
  const totalSessoes  = done.filter(b=>b.sessao?.valorCobrado).reduce((a,b)=>a+Number(b.sessao.valorCobrado),0);
  const totalCaixas   = donations.reduce((a,d)=>a+Number(d.caixas),0);
  const totalDuracao  = done.filter(b=>b.sessao?.duracao).reduce((a,b)=>a+Number(b.sessao.duracao),0);

  const StatCard = ({ label, value, sub, color="#f0f0f0", bg=T.surface, border=T.border }) => (
    <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:12, padding:"18px 20px" }}>
      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:38, color:color, letterSpacing:"0.04em", lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:11, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginTop:4 }}>{label}</div>
      {sub && <div style={{ fontSize:12, color:T.textDim, marginTop:4 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ maxWidth:680, margin:"0 auto", padding:"24px 16px" }}>
      <div style={{ background:"linear-gradient(135deg,#1c0406,#0a0a0a)", border:`1px solid ${T.accent}30`, borderRadius:14, padding:"20px 24px", marginBottom:24, textAlign:"center" }}>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:26, letterSpacing:"0.1em", color:T.accent, marginBottom:4 }}>Resumo do Evento</div>
        <div style={{ fontSize:13, color:T.textMuted }}>{event.name} — {fmtDate(event.date)}</div>
      </div>

      <div style={{ fontSize:11, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Sessoes</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:20 }}>
        <StatCard label="Realizadas" value={done.length} color="#60a5fa" bg="#0a1a2e" border="#60a5fa20" />
        <StatCard label="Confirmadas" value={confirmed.length} color={T.green} bg="#0d1a0d" border={T.greenDim} />
        <StatCard label="Ag. sinal" value={pending.length} color={T.amber} bg="#1c1400" border={T.amberDim} />
        <StatCard label="Canceladas" value={cancelled.length} color={T.red} bg="#200c0c" border={T.redDim} />
      </div>

      <div style={{ fontSize:11, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Financeiro</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:20 }}>
        <StatCard label="Sinais arrecadados" value={`R$ ${totalSinais}`} color={T.green} bg="#0d1a0d" border={T.greenDim} sub={`${bookings.filter(b=>b.status!=="cancelled").length} agendamentos`} />
        <StatCard label="Faturado em sessoes" value={`R$ ${totalSessoes}`} color="#60a5fa" bg="#0a1a2e" border="#60a5fa20" sub={`${done.filter(b=>b.sessao?.valorCobrado).length} sessoes lancadas`} />
      </div>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px", marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:11, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.07em" }}>Total estimado do dia</div>
          <div style={{ fontSize:12, color:T.textDim, marginTop:2 }}>sinais + sessoes realizadas</div>
        </div>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:34, color:T.accent, letterSpacing:"0.04em" }}>R$ {totalSinais + totalSessoes}</div>
      </div>

      <div style={{ fontSize:11, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Caixas de Bombom</div>
      <div style={{ background:"#1a0e00", border:"1px solid #f9731630", borderRadius:12, padding:"20px 24px", marginBottom:20, display:"flex", alignItems:"center", gap:20 }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:52, color:"#f97316", letterSpacing:"0.04em", lineHeight:1 }}>{totalCaixas}</div>
          <div style={{ fontSize:10, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.1em", marginTop:4 }}>caixas doadas</div>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, color:"#f97316", fontWeight:600, marginBottom:4 }}>Arrecadacao de Pascoa</div>
          <div style={{ fontSize:12, color:T.textMuted, lineHeight:1.6 }}>
            {donations.filter(d=>d.tipo==="cliente").reduce((a,d)=>a+Number(d.caixas),0)} de clientes + {donations.filter(d=>d.tipo==="doacao").reduce((a,d)=>a+Number(d.caixas),0)} de doacoes diretas
          </div>
        </div>
      </div>

      {totalDuracao > 0 && (
        <>
          <div style={{ fontSize:11, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Producao</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:20 }}>
            <StatCard label="Tempo total tatuando" value={`${Math.floor(totalDuracao/60)}h ${totalDuracao%60}min`} />
            <StatCard label="Media por sessao" value={done.length>0?`${Math.round(totalDuracao/done.length)} min`:"--"} />
          </div>
        </>
      )}
    </div>
  );
}


function DoacoesTab({ donations, onAddDonation, bookings }) {
  const totalCaixas = donations.reduce((a,d)=>a+d.caixas,0);
  const caixasClientes = donations.filter(d=>d.tipo==="cliente").reduce((a,d)=>a+d.caixas,0);
  const caixasDoacoes  = donations.filter(d=>d.tipo==="doacao").reduce((a,d)=>a+d.caixas,0);

  const fmtDate = iso => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  };

  return (
    <div style={{ maxWidth:700, margin:"0 auto", padding:"24px 16px" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:22 }}>
        {[
          { l:"Total de caixas", v:totalCaixas, clr:"#f97316", bg:"#1a0e00" },
          { l:"De clientes",     v:caixasClientes, clr:T.green, bg:"#0d1a0d" },
          { l:"Doacoes diretas", v:caixasDoacoes, clr:"#c084fc", bg:"#150d1a" },
        ].map(s=>(
          <div key={s.l} style={{ background:s.bg, border:`1px solid ${s.clr}20`, borderRadius:12, padding:"16px" }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:40, color:s.clr, letterSpacing:"0.04em", lineHeight:1 }}>{s.v}</div>
            <div style={{ fontSize:10, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.08em", marginTop:4 }}>{s.l}</div>
          </div>
        ))}
      </div>

      <div style={{ background:"#1a0e00", border:"1px solid #f9731630", borderRadius:12, padding:"14px 16px", marginBottom:22, display:"flex", alignItems:"center", gap:14 }}>
        <div style={{ fontSize:32 }}>🍫</div>
        <div>
          <div style={{ fontSize:14, fontWeight:600, color:"#f97316" }}>{totalCaixas} caixa{totalCaixas!==1?"s":""} de bombom arrecadada{totalCaixas!==1?"s":""}</div>
          <div style={{ fontSize:12, color:T.textMuted, marginTop:2 }}>Cada caixa vai alegrar uma crianca nesta Pascoa</div>
        </div>
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div style={{ fontSize:13, color:T.textMuted }}>Historico de arrecadacao</div>
        <button onClick={onAddDonation} style={{ ...btnP, padding:"8px 16px", fontSize:13 }}>+ Adicionar doacao</button>
      </div>

      {donations.length===0 && (
        <div style={{ textAlign:"center", color:T.textDim, padding:"48px 0", fontSize:14 }}>Nenhuma doacao registrada ainda.</div>
      )}

      {[...donations].reverse().map(d=>(
        <div key={d.id} style={{ background:T.surface, border:`1px solid ${d.tipo==="cliente"?T.greenDim:"#c084fc20"}`, borderRadius:10, padding:"14px 16px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
              <span style={{ fontWeight:600, fontSize:14, color:T.text }}>{d.nome}</span>
              <span style={{ fontSize:11, borderRadius:100, padding:"2px 9px", fontWeight:600,
                background:d.tipo==="cliente"?"#0d1a0d":"#150d1a",
                color:d.tipo==="cliente"?T.green:"#c084fc" }}>
                {d.tipo==="cliente" ? "Cliente" : "Doacao direta"}
              </span>
            </div>
            <div style={{ fontSize:12, color:T.textMuted }}>
              {fmtDate(d.data)}
              {d.obs && <span style={{ marginLeft:8, color:T.textDim }}>— {d.obs}</span>}
            </div>
          </div>
          <div style={{ textAlign:"center", flexShrink:0 }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:26, color:"#f97316", letterSpacing:"0.04em", lineHeight:1 }}>{d.caixas}</div>
            <div style={{ fontSize:10, color:T.textMuted, textTransform:"uppercase" }}>caixa{d.caixas!==1?"s":""}</div>
          </div>
        </div>
      ))}
    </div>
  );
}


function SessionModal({ sessionModal, sessionForm, setSessionForm, slots, onSave, onClose }) {
  if (!sessionModal) return null;
  const slot = slots.find(s=>s.id===sessionModal.slotId);
  return (
    <Overlay onClose={onClose}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:10, color:"#60a5fa", letterSpacing:"0.18em", marginBottom:4, textTransform:"uppercase" }}>Concluir sessao</div>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, letterSpacing:"0.04em", lineHeight:1 }}>{sessionModal.name}</div>
        <div style={{ fontSize:12, color:T.textMuted, marginTop:4, display:"flex", gap:12 }}>
          {slot && <span>Horario: {slot.time}</span>}
          {sessionModal.bodyPart && <span>Local: {sessionModal.bodyPart}</span>}
        </div>
      </div>

      {sessionModal.caixas > 0 && (
        <div style={{ background:"#1a0e00", border:"1px solid #f9731630", borderRadius:10, padding:"12px 16px", marginBottom:16, fontSize:12, color:"#f97316" }}>
          Cliente prometeu trazer <strong>{sessionModal.caixas} caixa{sessionModal.caixas>1?"s":""}</strong> de bombom — beneficio: flash de ate R${sessionModal.caixas===1?150:300}
        </div>
      )}

      <div style={{ background:T.surface3, borderRadius:10, padding:"14px 16px", marginBottom:18 }}>
        <div style={{ fontSize:10, color:T.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:12 }}>Caixas recebidas</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div>
            <label style={lbl}>Quantidade de caixas</label>
            <input type="number" min="0" placeholder="0" value={sessionForm.caixasRecebidas} onChange={e=>setSessionForm(p=>({...p,caixasRecebidas:e.target.value}))} onKeyDown={e=>{if(e.key==="ArrowUp"||e.key==="ArrowDown")e.preventDefault()}} style={{ ...inp, textAlign:"right" }} />
          </div>
          {Number(sessionForm.caixasRecebidas)>0 && (
            <div style={{ display:"flex", alignItems:"flex-end" }}>
              <div style={{ background:"#1a0e00", border:"1px solid #f9731630", borderRadius:8, padding:"10px 12px", fontSize:12, color:"#f97316", width:"100%", boxSizing:"border-box" }}>
                Beneficio: flash ate R${Number(sessionForm.caixasRecebidas)>=2?300:150}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ background:T.surface3, borderRadius:10, padding:"14px 16px", marginBottom:18 }}>
        <div style={{ fontSize:10, color:T.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:12 }}>Financeiro</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div>
            <label style={lbl}>Valor cobrado (R$)</label>
            <input type="number" placeholder="0,00" value={sessionForm.valorCobrado} onChange={e=>setSessionForm(p=>({...p,valorCobrado:e.target.value}))} onKeyDown={e=>{if(e.key==="ArrowUp"||e.key==="ArrowDown")e.preventDefault()}} style={{ ...inp, textAlign:"right" }} />
          </div>
          <div>
            <label style={lbl}>Duracao (min)</label>
            <input type="number" placeholder="60" value={sessionForm.duracao} onChange={e=>setSessionForm(p=>({...p,duracao:e.target.value}))} onKeyDown={e=>{if(e.key==="ArrowUp"||e.key==="ArrowDown")e.preventDefault()}} style={{ ...inp, textAlign:"right" }} />
          </div>
        </div>
      </div>

      <div style={{ background:T.surface3, borderRadius:10, padding:"14px 16px", marginBottom:18 }}>
        <div style={{ fontSize:10, color:T.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:12 }}>Materiais utilizados</div>
        <div style={{ marginBottom:14 }}>
          <label style={lbl}>Agulhas</label>
          <input type="text" placeholder="Ex: 1x RL5, 1x M7" value={sessionForm.agulhas} onChange={e=>setSessionForm(p=>({...p,agulhas:e.target.value}))} style={inp} />
        </div>
        <div style={{ marginBottom:4 }}>
          <label style={lbl}>Tintas / cores</label>
          <input type="text" placeholder="Ex: Preto, Cinza, Branco" value={sessionForm.tintas} onChange={e=>setSessionForm(p=>({...p,tintas:e.target.value}))} style={inp} />
        </div>
      </div>

      <div style={{ marginBottom:22 }}>
        <label style={lbl}>Observacoes da sessao</label>
        <textarea placeholder="Como foi a sessao, retoque necessario, etc..." value={sessionForm.obs} onChange={e=>setSessionForm(p=>({...p,obs:e.target.value}))} style={{ ...inp, height:72, resize:"vertical" }} />
      </div>

      <div style={{ background:"#0a1a2e", border:"1px solid #60a5fa30", borderRadius:8, padding:"10px 14px", marginBottom:20, fontSize:12, color:"#93c5fd", lineHeight:1.6 }}>
        O agendamento sera marcado como <strong>Realizado</strong> ao salvar.
      </div>

      <div style={{ display:"flex", gap:10 }}>
        <button onClick={onClose} style={{ ...btnS, flex:1 }}>Cancelar</button>
        <button onClick={onSave} style={{ ...btnP, flex:2 }}>Concluir sessao</button>
      </div>
    </Overlay>
  );
}

export default function FlashDay() {
  const [view, setView]           = useState("agenda");
  const [adminTab, setAdminTab]   = useState("bookings");
  const [adminAuth, setAdminAuth] = useState(false);
  const [loginPwd, setLoginPwd]   = useState("");
  const [loginErr, setLoginErr]   = useState(false);
  const [storedPwd, setStoredPwd] = useState(()=>localStorage.getItem("fd_admin_pwd")||"inkstation2026");
  const [pwdLoaded, setPwdLoaded]   = useState(false);
  const [event, setEvent]         = useState(INIT_EVENT);
  const [slots, setSlots]         = useState(INIT_SLOTS);
  const [bookings, setBookings]   = useState(INIT_BOOKINGS);
  const [loading, setLoading]     = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookModal, setBookModal] = useState(null);
  const [bookForm, setBookForm]   = useState({ name:"", phone:"", dob:"", bodyPart:"", caixas:0, notes:"" });
  const [bookStep, setBookStep]   = useState("form");
  const [editModal, setEditModal] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [sessionModal, setSessionModal] = useState(null);
  const [donations, setDonations]       = useState(INIT_DONATIONS);
  const [donationModal, setDonationModal] = useState(false);
  const [donationForm, setDonationForm]  = useState({ nome:"", caixas:1, obs:"" });
  const [savedTemplate, setSavedTemplate] = useState(null);
  const [toast, setToast]         = useState(null);
  const [search, setSearch]       = useState("");
  const [filterSt, setFilterSt]   = useState("all");
  const [sortBy, setSortBy]       = useState("time");
  const [settingsForm, setSettingsForm] = useState({...INIT_EVENT});
  const [sessionForm, setSessionForm] = useState({ valorCobrado:"", duracao:"", agulhas:"", tintas:"", caixasRecebidas:0, obs:"" });
  const [pwdForm, setPwdForm]     = useState({ current:"", newPwd:"", confirm:"" });
  const [pwdErr, setPwdErr]       = useState("");
  const [pixConfig, setPixConfig] = useState(INIT_PIX);
  const [flashLink, setFlashLink] = useState("");

  useEffect(()=>{
    const l=document.createElement("link");
    l.rel="stylesheet"; l.href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(l);
    Object.assign(document.body.style,{margin:"0",background:T.bg,color:T.text,fontFamily:"'DM Sans',sans-serif"});
    if (!window.emailjs) {
      const s=document.createElement("script");
      s.src="https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
      s.onload=()=>window.emailjs.init(EMAILJS_PUBLIC_KEY);
      document.head.appendChild(s);
    }
    loadAllData();
  },[]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      // Load event config
      const { data: cfgRows } = await supabase.from("event_config").select("*").limit(1);
      if (cfgRows && cfgRows.length > 0) {
        const cfg = cfgRows[0];
        const ev = {
          name: cfg.name, date: cfg.date||"", location: cfg.location||"",
          startTime: cfg.start_time||"10:00", endTime: cfg.end_time||"20:00",
          interval: cfg.interval_min||30, capacity: cfg.capacity||3,
        };
        setEvent(ev);
        setSettingsForm(ev);
        if (cfg.pix_key) setPixConfig({ key:cfg.pix_key, keyType:cfg.pix_key_type||"cpf", holderName:cfg.pix_holder_name||"", bank:cfg.pix_bank||"" });
        if (cfg.flash_link) setFlashLink(cfg.flash_link);
        if (cfg.admin_password) {
          setStoredPwd(cfg.admin_password);
          localStorage.setItem("fd_admin_pwd", cfg.admin_password);
        }
        setPwdLoaded(true);
      }
      // Load slots
      const { data: slotRows } = await supabase.from("slots").select("*");
      if (slotRows && slotRows.length > 0) {
        const toMin = t => { const [h,m]=(t||"0:0").split(":").map(Number); return h*60+m; };
        const sorted = [...slotRows].sort((a,b)=> toMin(a.time) - toMin(b.time));
        setSlots(sorted.map(s=>({ id:s.id, time:s.time, blocked:s.blocked })));
      }
      // Load bookings
      const { data: bookRows } = await supabase.from("bookings").select("*").order("created_at");
      if (bookRows) {
        setBookings(bookRows.map(b=>({
          id: b.id, slotId: b.slot_id, name: b.name, phone: b.phone,
          dob: b.dob||"", bodyPart: b.body_part||"", caixas: b.caixas||0,
          notes: b.notes||"", status: b.status, sessao: b.sessao||null,
          createdAt: b.created_at||"",
        })));
      }
      // Load donations
      const { data: donRows } = await supabase.from("donations").select("*").order("created_at");
      if (donRows) {
        setDonations(donRows.map(d=>({ id:d.id, tipo:d.tipo, nome:d.nome, caixas:d.caixas, obs:d.obs||"", data:d.created_at, bookingId:d.booking_id })));
      }
    } catch(e) { console.error("Erro ao carregar dados:", e); }
    setLoading(false);
  };

  // Realtime - atualiza bookings em tempo real quando outro cliente agenda
  useEffect(()=>{
    const channel = supabase.channel("bookings-realtime")
      .on("postgres_changes", { event:"INSERT", schema:"public", table:"bookings" }, payload=>{
        const b = payload.new;
        setBookings(p=>{
          // evita duplicidade: ignora se ja existe com mesmo id real
          if (p.find(x=>x.id===b.id)) return p;
          // remove qualquer entrada temp com mesmo nome+slot (criada localmente antes)
          const filtered = p.filter(x=>!(x.id.startsWith("temp-")&&x.slotId===b.slot_id&&x.name===b.name));
          return [...filtered, { id:b.id, slotId:b.slot_id, name:b.name, phone:b.phone, dob:b.dob||"", bodyPart:b.body_part||"", caixas:b.caixas||0, notes:b.notes||"", status:b.status, sessao:null, createdAt:b.created_at||"" }];
        });
      })
      .on("postgres_changes", { event:"UPDATE", schema:"public", table:"bookings" }, payload=>{
        const b = payload.new;
        setBookings(p=>p.map(x=>x.id===b.id ? { ...x, status:b.status, sessao:b.sessao } : x));
      })
      .subscribe();
    return ()=>supabase.removeChannel(channel);
  },[]);

  const showToast = useCallback((msg,type="ok")=>{setToast({msg,type});setTimeout(()=>setToast(null),3200);},[]);

  const slotStats = useMemo(()=>{
    const m={};
    slots.forEach(s=>{ const active=bookings.filter(b=>b.slotId===s.id&&b.status!=="cancelled"); m[s.id]={count:active.length,list:active}; });
    return m;
  },[slots,bookings]);

  const getStatus = useCallback(slot=>{
    if (slot.blocked) return "blocked";
    const n=slotStats[slot.id]?.count??0;
    if (n>=event.capacity) return "full";
    if (event.capacity>1&&n>=event.capacity-1) return "last";
    return "available";
  },[slotStats,event.capacity]);

  const gStats = useMemo(()=>({
    pending:   bookings.filter(b=>b.status==="pending").length,
    confirmed: bookings.filter(b=>b.status==="confirmed").length,
    done:      bookings.filter(b=>b.status==="done").length,
    cancelled: bookings.filter(b=>b.status==="cancelled").length,
    totalSinais: bookings.filter(b=>b.status!=="cancelled").length * SINAL_VALOR,
    totalSessoes: bookings.filter(b=>b.status==="done"&&b.sessao?.valorCobrado).reduce((a,b)=>a+Number(b.sessao.valorCobrado),0),
  }),[bookings]);

  const filteredBookings = useMemo(()=>{
    const toMin = t => { const [h,m]=(t||"0:0").split(":").map(Number); return h*60+m; };
    const filtered = bookings.filter(b=>{
      if (filterSt!=="all"&&b.status!==filterSt) return false;
      if (search){ const q=search.toLowerCase(); return b.name.toLowerCase().includes(q)||b.phone.includes(q); }
      return true;
    });
    if (sortBy==="time") {
      filtered.sort((a,b)=>{ const sa=slots.find(s=>s.id===a.slotId); const sb=slots.find(s=>s.id===b.slotId); return toMin(sa?.time)-toMin(sb?.time); });
    } else if (sortBy==="newest") {
      filtered.sort((a,b)=>{ const ta=new Date(a.createdAt).getTime()||0; const tb=new Date(b.createdAt).getTime()||0; return tb-ta; });
    } else {
      filtered.sort((a,b)=>{ const ta=new Date(a.createdAt).getTime()||0; const tb=new Date(b.createdAt).getTime()||0; return ta-tb; });
    }
    return filtered;
  },[bookings,filterSt,search,sortBy,slots]);

  const handleLogin = ()=>{ if(loginPwd===storedPwd){setAdminAuth(true);setLoginErr(false);setLoginPwd("");}else{setLoginErr(true);setLoginPwd("");} };
  const handleChangePwd = async newPwd=>{
    localStorage.setItem("fd_admin_pwd", newPwd);
    setStoredPwd(newPwd);
    const { data:cfgRows } = await supabase.from("event_config").select("id").limit(1);
    if (cfgRows && cfgRows.length > 0) {
      await supabase.from("event_config").update({ admin_password: newPwd }).eq("id", cfgRows[0].id);
    }
    showToast("Senha atualizada em todos os dispositivos!");
  };

  const sendNotificationEmail = (bookingData, slotTime) => {
    if (EMAILJS_SERVICE_ID==="SEU_SERVICE_ID") return;
    const params = {
      to_email:     NOTIF_EMAIL,
      to_name:      "Ink Station",
      client_name:  bookingData.name,
      client_phone: bookingData.phone,
      client_dob:   bookingData.dob,
      slot_time:    slotTime,
      event_name:   event.name,
      event_date:   event.date,
      notes:        bookingData.notes || "Nenhuma",
    };
    const doSend = () => {
      if (!window.emailjs) { setTimeout(doSend, 300); return; }
      window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, params)
        .then(()=>console.log("Email enviado!"))
        .catch(err=>console.warn("EmailJS error:", err));
    };
    doSend();
  };

  const handleBook = async ()=>{
    if (isSubmitting) return; // bloqueia duplo clique
    if (!bookForm.name.trim())    { showToast("Nome e obrigatorio","err"); return; }
    if (!bookForm.phone.trim())   { showToast("Telefone e obrigatorio","err"); return; }
    if (!bookForm.dob)            { showToast("Data de nascimento e obrigatoria","err"); return; }
    if (calcAge(bookForm.dob)<18) { showToast("E necessario ter 18 anos ou mais","err"); return; }
    const n=slotStats[bookModal.slotId]?.count??0;
    if (n>=event.capacity)        { showToast("Horario ja esta cheio","err"); return; }
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("bookings").insert([{
        slot_id: bookModal.slotId,
        name: bookForm.name,
        phone: bookForm.phone,
        dob: bookForm.dob || null,
        body_part: bookForm.bodyPart || null,
        caixas: bookForm.caixas || 0,
        notes: bookForm.notes || null,
        status: "pending",
        created_at: new Date().toISOString(),
      }]);
      if (error) { showToast("Erro ao salvar agendamento","err"); console.error(error); return; }
      // NAO adicionar localmente — o Realtime ja vai inserir via postgres_changes INSERT
      sendNotificationEmail(bookForm, bookModal.time);
      setBookStep("payment");
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeBookModal = ()=>{ setBookModal(null); setBookStep("form"); setBookForm({name:"",phone:"",dob:"",bodyPart:"",caixas:0,notes:""}); };

  const handleConfirmSinal = async id=>{
    await supabase.from("bookings").update({status:"confirmed"}).eq("id",id);
    setBookings(p=>p.map(b=>b.id===id?{...b,status:"confirmed"}:b));
    const booking = bookings.find(b=>b.id===id);
    const slot    = slots.find(s=>s.id===booking?.slotId);
    if (booking && slot) {
      const phone = booking.phone.replace(/\D/g,"");
      const eventDate = event.date
        ? new Date(event.date+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"})
        : "";
      const msgParts = [
        "Ola, " + booking.name + "!",
        "",
        "Seu pagamento do sinal foi confirmado e seu agendamento esta garantido!",
        "",
        "Detalhes do seu agendamento:",
        "Evento: " + event.name,
        "Data: " + eventDate,
        "Horario: " + slot.time,
        "Local: " + event.location,
      ];
      if (booking.notes) msgParts.push("Observacoes: " + booking.notes);
      msgParts.push("", "Lembre-se de chegar com alguns minutos de antecedencia.", "Em caso de duvidas, estamos a disposicao!");
      const msg = msgParts.join("\n");
      const url = "https://wa.me/55" + phone + "?text=" + encodeURIComponent(msg);
      window.open(url,"_blank","noopener");
    }
    showToast("Sinal confirmado! WhatsApp abrindo...");
  };

  const handleSendReminder = (booking)=>{
    const slot = slots.find(s=>s.id===booking.slotId);
    if (!slot) return;
    const phone = booking.phone.replace(/\D/g,"");
    const eventDate = event.date
      ? new Date(event.date+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"})
      : "";
    const msgParts = [
      "Ola, " + booking.name + "!",
      "",
      "Lembramos que seu agendamento no " + event.name + " e amanha!",
      "",
      "Detalhes:",
      "Data: " + eventDate,
      "Horario: " + slot.time,
      "Local: " + event.location,
      booking.bodyPart ? "Tatuagem: " + booking.bodyPart : "",
      "",
      "Lembre-se de:",
      "- Chegar com 10 min de antecedencia",
      "- Estar bem alimentado(a)",
      "- Usar roupa que facilite o acesso ao local da tatuagem",
      booking.caixas>0 ? "- Trazer " + booking.caixas + " caixa(s) de bombom (Lacta ou Nestle) para o desconto!" : "",
      "",
      "Te esperamos! Em caso de duvidas, estamos a disposicao.",
    ].filter(Boolean);
    const msg = msgParts.join("\n");
    const url = "https://wa.me/55" + phone + "?text=" + encodeURIComponent(msg);
    window.open(url,"_blank","noopener");
    showToast("WhatsApp de lembrete abrindo...");
  };

  const handleSaveDonation = async ()=>{
    if (!donationForm.nome.trim()) return;
    const { error } = await supabase.from("donations").insert([{
      tipo:"doacao", nome:donationForm.nome, caixas:Number(donationForm.caixas)||1, obs:donationForm.obs||null
    }]);
    if (!error) setDonations(p=>[...p,{ id:"d"+Date.now(), tipo:"doacao", nome:donationForm.nome, caixas:Number(donationForm.caixas)||1, obs:donationForm.obs||"", data:new Date().toISOString() }]);
    setDonationModal(false);
    setDonationForm({ nome:"", caixas:1, obs:"" });
    showToast("Doacao registrada!");
  };

  const handleOpenSession = (booking)=>{
    setSessionModal(booking);
    setSessionForm({ valorCobrado:"", duracao:"", agulhas:"", tintas:"", caixasRecebidas:0, obs:"" });
  };

  const handleSaveSession = async ()=>{
    const caixasCliente = Number(sessionForm.caixasRecebidas)||0;
    const sessaoData = { ...sessionForm, concluidoEm: new Date().toISOString() };
    await supabase.from("bookings").update({ status:"done", sessao:sessaoData }).eq("id",sessionModal.id);
    setBookings(p=>p.map(b=>b.id===sessionModal.id ? { ...b, status:"done", sessao:sessaoData } : b));
    if (caixasCliente > 0) {
      const { error:donErr } = await supabase.from("donations").insert([{
        tipo:"cliente", nome:sessionModal.name, caixas:caixasCliente,
        obs:"Caixas recebidas na sessao", booking_id:sessionModal.id
      }]);
      if (!donErr) setDonations(p=>[...p,{ id:"d"+Date.now(), tipo:"cliente", nome:sessionModal.name, caixas:caixasCliente, obs:"Caixas recebidas na sessao", data:new Date().toISOString(), bookingId:sessionModal.id }]);
    }
    setSessionModal(null);
    showToast("Sessao concluida!");
  };

  const handleSaveEdit = async ()=>{
    await supabase.from("bookings").update({
      name: editModal.name, phone: editModal.phone,
      dob: editModal.dob||null, body_part: editModal.bodyPart||null,
      status: editModal.status, notes: editModal.notes||null,
    }).eq("id", editModal.id);
    setBookings(p=>p.map(b=>b.id===editModal.id?editModal:b));
    setEditModal(null); showToast("Agendamento atualizado");
  };
  const handleDeleteBooking = async id=>{
    await supabase.from("bookings").delete().eq("id",id);
    setBookings(p=>p.filter(b=>b.id!==id));
    showToast("Agendamento excluido.");
  };

  const handleCancelConfirm = async id=>{
    await supabase.from("bookings").update({status:"cancelled"}).eq("id",id);
    setBookings(p=>p.map(b=>b.id===id?{...b,status:"cancelled"}:b));
    setEditModal(null); setConfirmId(null); showToast("Agendamento cancelado");
  };

  const handleSaveTemplate = ()=>{
    localStorage.setItem('fd_template', JSON.stringify(settingsForm));
    setSavedTemplate({...settingsForm});
    showToast("Template salvo!");
  };
  const handleLoadTemplate = ()=>{
    if (!savedTemplate) return;
    setSettingsForm({...savedTemplate});
    showToast("Template carregado!");
  };

  const handleSaveEvent = async ()=>{
    const newSlots = genSlots(settingsForm.startTime,settingsForm.endTime,settingsForm.interval);
    const ev = {...settingsForm, interval:parseInt(settingsForm.interval), capacity:parseInt(settingsForm.capacity)};
    // Save event config (upsert single row)
    const { data:cfgRows } = await supabase.from("event_config").select("id").limit(1);
    if (cfgRows && cfgRows.length > 0) {
      await supabase.from("event_config").update({
        name:ev.name, date:ev.date||null, location:ev.location,
        start_time:ev.startTime, end_time:ev.endTime,
        interval_min:ev.interval, capacity:ev.capacity,
      }).eq("id", cfgRows[0].id);
    } else {
      await supabase.from("event_config").insert({
        name:ev.name, date:ev.date||null, location:ev.location,
        start_time:ev.startTime, end_time:ev.endTime,
        interval_min:ev.interval, capacity:ev.capacity,
      });
    }
    // Upsert slots — insere novos, mantém os existentes com seus agendamentos
    const { data:existingSlots } = await supabase.from("slots").select("id");
    const existingIds = (existingSlots||[]).map(s=>s.id);
    const newOnly = newSlots.filter(s=>!existingIds.includes(s.id));
    if (newOnly.length > 0) {
      await supabase.from("slots").insert(newOnly.map(s=>({ id:s.id, time:s.time, blocked:false })));
    }
    // Atualiza estado local — mantém agendamentos existentes
    const mergedSlots = newSlots.map(s=>{
      const existing = slots.find(e=>e.id===s.id);
      return existing || s;
    });
    const toMin2 = t => { const [h,m]=(t||"0:0").split(":").map(Number); return h*60+m; };
    mergedSlots.sort((a,b)=>toMin2(a.time)-toMin2(b.time));
    setSlots(mergedSlots); setEvent(ev);
    showToast("Configuracoes salvas!");
  };

  const handleSavePix = async (cfg)=>{
    const { data:cfgRows } = await supabase.from("event_config").select("id").limit(1);
    const pixData = { pix_key:cfg.key, pix_key_type:cfg.keyType, pix_holder_name:cfg.holderName, pix_bank:cfg.bank };
    if (cfgRows && cfgRows.length > 0) {
      await supabase.from("event_config").update(pixData).eq("id", cfgRows[0].id);
    } else {
      await supabase.from("event_config").insert({ name:event.name, ...pixData });
    }
    setPixConfig(cfg); showToast("Dados Pix salvos!");
  };
  const handleSaveFlashLink = async (link)=>{
    const { data:cfgRows } = await supabase.from("event_config").select("id").limit(1);
    if (cfgRows && cfgRows.length > 0) {
      await supabase.from("event_config").update({ flash_link:link }).eq("id", cfgRows[0].id);
    }
    setFlashLink(link); showToast("Link dos designs salvo!");
  };

  const handleSavePwd = ()=>{
    if (pwdForm.current!==storedPwd)      { setPwdErr("Senha atual incorreta."); return; }
    if (pwdForm.newPwd.length<6)          { setPwdErr("A nova senha precisa ter pelo menos 6 caracteres."); return; }
    if (pwdForm.newPwd!==pwdForm.confirm) { setPwdErr("As senhas nao coincidem."); return; }
    handleChangePwd(pwdForm.newPwd); setPwdForm({current:"",newPwd:"",confirm:""}); setPwdErr("");
  };

  if (loading) return (
    <div style={{ background:T.bg, minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',sans-serif", color:T.text }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:32, color:T.accent, letterSpacing:"0.12em", marginBottom:12 }}>INK STATION</div>
        <div style={{ fontSize:13, color:T.textMuted }}>Carregando...</div>
      </div>
    </div>
  );

  return (
    <div style={{ background:T.bg, minHeight:"100vh", fontFamily:"'DM Sans',sans-serif", color:T.text }}>
      <header style={{ position:"sticky", top:0, zIndex:50, background:T.bg, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 18px", height:54 }}>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, letterSpacing:"0.12em", lineHeight:1 }}>
          <span style={{ color:T.accent }}>INK</span><span style={{ color:"#cccccc" }}> STATION</span>
        </div>
        <div style={{ display:"flex", gap:4 }}>
          {[{v:"agenda",l:"Agenda"},{v:"admin",l:"Admin"}].map(t=>(
            <button key={t.v} onClick={()=>setView(t.v)} style={{ background:view===t.v?T.accentDim:"transparent", color:view===t.v?T.accent:T.textMuted, border:`1px solid ${view===t.v?T.accent:"transparent"}`, borderRadius:8, padding:"6px 14px", fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>{t.l}</button>
          ))}
        </div>
      </header>

      {view==="agenda" ? (
        <AgendaView event={event} slots={slots} slotStats={slotStats} getStatus={getStatus} onBook={setBookModal} flashLink={flashLink} />
      ) : !adminAuth ? (
        <LoginScreen loginPwd={loginPwd} setLoginPwd={setLoginPwd} loginErr={loginErr} setLoginErr={setLoginErr} onLogin={handleLogin} />
      ) : (
        <div style={{ minHeight:"100vh" }}>
          <div style={{ display:"flex", borderBottom:`1px solid ${T.border}`, background:T.surface, padding:"0 20px", overflowX:"auto", alignItems:"center" }}>
            <div style={{ display:"flex", flex:1 }}>
              {[{id:"bookings",label:"Agendamentos"},{id:"doacoes",label:"Doacoes"},{id:"resumo",label:"Resumo"},{id:"slots",label:"Horarios"},{id:"settings",label:"Configuracoes"}].map(t=>(
                <button key={t.id} onClick={()=>setAdminTab(t.id)} style={{ background:"none", border:"none", color:adminTab===t.id?T.accent:T.textMuted, fontFamily:"'DM Sans',sans-serif", fontSize:14, fontWeight:500, padding:"15px 18px", cursor:"pointer", borderBottom:`2px solid ${adminTab===t.id?T.accent:"transparent"}`, whiteSpace:"nowrap" }}>{t.label}</button>
              ))}
            </div>
            <button onClick={()=>{setAdminAuth(false);setView("agenda");}} style={{ background:"transparent", border:"none", color:T.textDim, fontSize:12, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", padding:"0 4px", flexShrink:0 }}>Sair</button>
          </div>
          {adminTab==="bookings" && <BookingsTab gStats={gStats} filteredBookings={filteredBookings} slots={slots} search={search} setSearch={setSearch} filterSt={filterSt} setFilterSt={setFilterSt} sortBy={sortBy} setSortBy={setSortBy} onEdit={b=>setEditModal({...b})} onConfirm={handleConfirmSinal} onConcluir={handleOpenSession} onReminder={handleSendReminder} onDelete={handleDeleteBooking} />}
          {adminTab==="doacoes"  && <DoacoesTab donations={donations} onAddDonation={()=>setDonationModal(true)} bookings={bookings} />}
          {adminTab==="resumo"   && <ResumoTab bookings={bookings} donations={donations} slots={slots} event={event} />}
          {adminTab==="slots"    && <SlotsTab slots={slots} setSlots={setSlots} slotStats={slotStats} event={event} getStatus={getStatus} />}
          {adminTab==="settings" && <SettingsTab settingsForm={settingsForm} setSettingsForm={setSettingsForm} pwdForm={pwdForm} setPwdForm={setPwdForm} pwdErr={pwdErr} setPwdErr={setPwdErr} onSaveEvent={handleSaveEvent} onSavePwd={handleSavePwd} pixConfig={pixConfig} onSavePix={handleSavePix} flashLink={flashLink} onSaveFlashLink={handleSaveFlashLink} savedTemplate={savedTemplate} onSaveTemplate={handleSaveTemplate} onLoadTemplate={handleLoadTemplate} />}
        </div>
      )}

      <BookModal bookModal={bookModal} bookForm={bookForm} setBookForm={setBookForm} bookStep={bookStep} onBook={handleBook} onClose={closeBookModal} pixConfig={pixConfig} event={event} isSubmitting={isSubmitting} />
      <EditModal editModal={editModal} setEditModal={setEditModal} slots={slots} onSave={handleSaveEdit} onRequestCancel={()=>setConfirmId(editModal.id)} />

      {donationModal && (
        <Overlay onClose={()=>setDonationModal(false)}>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:10, color:"#f97316", letterSpacing:"0.18em", marginBottom:4, textTransform:"uppercase" }}>Registrar doacao de caixas</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color:T.text, letterSpacing:"0.04em" }}>Adicionar Doacao</div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={lbl}>Nome do doador</label>
            <input type="text" placeholder="Nome da pessoa ou empresa" value={donationForm.nome} onChange={e=>setDonationForm(p=>({...p,nome:e.target.value}))} style={inp} />
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={lbl}>Quantidade de caixas</label>
            <input type="number" min="1" placeholder="Ex: 3" value={donationForm.caixas} onChange={e=>setDonationForm(p=>({...p,caixas:e.target.value}))} onKeyDown={e=>{if(e.key==="ArrowUp"||e.key==="ArrowDown")e.preventDefault()}} style={inp} />
          </div>
          <div style={{ marginBottom:22 }}>
            <label style={lbl}>Observacoes (opcional)</label>
            <input type="text" placeholder="Ex: Funcionario, doacao anonima..." value={donationForm.obs} onChange={e=>setDonationForm(p=>({...p,obs:e.target.value}))} style={inp} />
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setDonationModal(false)} style={{ ...btnS, flex:1 }}>Cancelar</button>
            <button onClick={handleSaveDonation} style={{ ...btnP, flex:2 }}>Registrar doacao</button>
          </div>
        </Overlay>
      )}
      <SessionModal sessionModal={sessionModal} sessionForm={sessionForm} setSessionForm={setSessionForm} slots={slots} onSave={handleSaveSession} onClose={()=>setSessionModal(null)} />

      {confirmId && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.92)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:T.surface, borderRadius:14, padding:"28px 24px", maxWidth:340, width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:17, fontWeight:600, color:T.text, marginBottom:8 }}>Cancelar agendamento?</div>
            <div style={{ fontSize:13, color:T.textMuted, marginBottom:22 }}>A vaga sera liberada automaticamente.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setConfirmId(null)} style={{ ...btnS, flex:1 }}>Voltar</button>
              <button onClick={()=>handleCancelConfirm(confirmId)} style={{ ...btnD, flex:1 }}>Sim, cancelar</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position:"fixed", bottom:28, left:"50%", transform:"translateX(-50%)", background:toast.type==="err"?"#200c0c":"#0a2018", color:toast.type==="err"?T.red:T.green, border:`1px solid ${toast.type==="err"?T.redDim:T.greenDim}`, borderRadius:100, padding:"10px 22px", fontSize:13, fontWeight:500, zIndex:300, whiteSpace:"nowrap", pointerEvents:"none" }}>
          {toast.type!=="err"?"OK ":"X "}{toast.msg}
        </div>
      )}
    </div>
  );
}
