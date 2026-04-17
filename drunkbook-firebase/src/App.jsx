import { useState, useEffect, useRef } from "react";
import { auth, db, requestNotificationPermission, onMessage } from "./firebase";
import { getMessaging } from "firebase/messaging";
import { getApp } from "firebase/app";
import { LANGS } from "./translations";

let messaging = null;
try { messaging = getMessaging(getApp()); } catch(e) {}
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
} from "firebase/auth";
import {
  doc, setDoc, getDoc, collection, addDoc, onSnapshot,
  query, orderBy, updateDoc, serverTimestamp, where, deleteDoc
} from "firebase/firestore";

const DRINKS = ["🍺","🍻","🥃","🍷","🍸","🍹","🥂","🍾"];
const TITLES = ["Încă Sobru","Prima Bere","Al Doilea Rând","Vibe Check","Deja Fluent","Filozoful Barului","Regele Mesei","Legendă Vie"];
const SECTORS = [
  {id:"buiucani",  label:"Buiucani",   emoji:"🏘️"},
  {id:"botanica",  label:"Botanica",   emoji:"🌿"},
  {id:"centru",    label:"Centru",     emoji:"🏙️"},
  {id:"telecentru",label:"Telecentru", emoji:"📡"},
  {id:"ciocana",   label:"Ciocana",    emoji:"🏗️"},
  {id:"rascanovca",label:"Râșcanovca", emoji:"🌆"},
  {id:"suburbie",  label:"Suburbie",   emoji:"🌳"},
];
const IMGBB_KEY = "8a79556a7f61c84b45baf5005c507fe2";

const CHALLENGE_TEMPLATES = [
  "🍺 Bea o bere dintr-o înghițitură!",
  "💃 Fă un dans de 30 de secunde!",
  "📸 Fă o poză cu cel mai ciudat lucru din jur!",
  "🗣️ Vorbește cu accent timp de 5 minute!",
  "🤣 Spune o glumă proastă!",
  "🍋 Mănâncă o felie de lămâie fără să te strâmbi!",
  "🎤 Cântă refrenul ultimei melodii ascultate!",
  "🙈 Nu mai folosi telefonul 10 minute!",
  "🥃 Comandă runda următoare!",
  "🤸 Fă 10 flotări acum!",
];

const BADGE_DEFS = [
  { id:"veteran",    icon:"🍺", name:"Veteran",        desc:"Cont mai vechi de 7 zile" },
  { id:"popular",   icon:"🥇", name:"Regele Barului",  desc:"Cel mai multe cheers total" },
  { id:"onfire",    icon:"🔥", name:"On Fire",         desc:"5+ postări în ultimele 7 zile" },
  { id:"chatterbox",icon:"💬", name:"Gura Satului",    desc:"20+ comentarii scrise" },
  { id:"vip",       icon:"⭐", name:"VIP",             desc:"Rating mediu peste 4.5 stele" },
  { id:"explorer",  icon:"📍", name:"Explorer",        desc:"Locație activată" },
  { id:"critic",    icon:"🎭", name:"Critic de Bar",   desc:"A scris 5+ recenzii" },
  { id:"daredevil", icon:"🎯", name:"Curajos",         desc:"A acceptat 3+ provocări" },
];

function computeBadges(user, posts, allUsers) {
  const badges = [];
  const userPosts = posts.filter(p => p.userId === user.id || p.userId === user.uid);
  const totalLikes = userPosts.reduce((s,p) => s+(p.likes||[]).length, 0);
  const totalComments = userPosts.reduce((s,p) => s+(p.commentCount||0), 0);
  const weekAgo = Date.now() - 7*24*3600*1000;
  const recentPosts = userPosts.filter(p => p.createdAt?.seconds*1000 > weekAgo);
  const accountAge = user.createdAt?.seconds ? (Date.now() - user.createdAt.seconds*1000) : 0;
  const maxLikes = Math.max(0, ...allUsers.map(u => posts.filter(p=>p.userId===u.id||p.userId===u.uid).reduce((s,p)=>s+(p.likes||[]).length,0)));
  if (accountAge > 7*24*3600*1000) badges.push("veteran");
  if (totalLikes > 0 && totalLikes >= maxLikes && allUsers.length > 1) badges.push("popular");
  if (recentPosts.length >= 5) badges.push("onfire");
  if (totalComments >= 20) badges.push("chatterbox");
  if ((user.avgRating||0) >= 4.5 && (user.totalRatings||0) >= 3) badges.push("vip");
  if (user.lat) badges.push("explorer");
  if ((user.ratings||[]).length >= 5) badges.push("critic");
  if ((user.challengesAccepted||0) >= 3) badges.push("daredevil");
  return badges;
}

function getTitle(r){if(!r||r<1)return TITLES[0];if(r<2)return TITLES[1];if(r<3)return TITLES[2];if(r<4)return TITLES[3];if(r<5)return TITLES[4];if(r<6)return TITLES[5];if(r<8)return TITLES[6];return TITLES[7];}
function distKm(lat1,lon1,lat2,lon2){const R=6371,dLat=((lat2-lat1)*Math.PI)/180,dLon=((lon2-lon1)*Math.PI)/180,a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function timeAgo(ts, L){
  if(!ts)return "";
  const l=L||LANGS.ro;
  const diff=Date.now()-(ts.seconds?ts.seconds*1000:ts);
  if(diff<60000)return l.nowLabel;
  if(diff<3600000)return Math.floor(diff/60000)+l.minLabel+(l.ago?" "+l.ago:"");
  if(diff<86400000)return Math.floor(diff/3600000)+l.hLabel+(l.ago?" "+l.ago:"");
  return Math.floor(diff/86400000)+l.zLabel+(l.ago?" "+l.ago:"");
}
function getStatus(user, L){
  const l=L||LANGS.ro;
  if(!user)return null;
  if(user.online)return{dot:"#4caf82",label:l.online,short:"🟢"};
  if(!user.lastSeen)return{dot:"#555",label:l.unknown,short:"⚫"};
  const diff=Date.now()-user.lastSeen.seconds*1000;
  if(diff<3*60*1000)return{dot:"#4caf82",label:l.online,short:"🟢"};
  if(diff<30*60*1000)return{dot:"#f5a623",label:l.activeRecently,short:"🟡"};
  return{dot:"#555",label:`${timeAgo(user.lastSeen,l)}`,short:"⚫"};
}
function getChatId(a,b){return [a,b].sort().join("_");}
function setCookie(n,v,d=365){document.cookie=`${n}=${encodeURIComponent(v)};path=/;max-age=${d*86400};SameSite=Lax`;}
function getCookie(n){return decodeURIComponent(document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith(n+'='))?.split('=')[1]||'');}
function deleteCookie(n){document.cookie=`${n}=;path=/;max-age=0`;}
async function uploadToImgbb(file){
  try{
    const fd=new FormData();
    fd.append('image',file);
    const r=await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`,{method:'POST',body:fd});
    const d=await r.json();
    if(d.success)return d.data.url;
    throw new Error(d.error?.message||'Upload failed');
  }catch(e){
    console.error('Upload error:',e);
    throw e;
  }
}

// ===== SPIN THE BOTTLE COMPONENT =====
function SpinBottle({ allUsers, currentUser, onSpun, profile, L }) {
  const l = L || LANGS.ro;
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [selected, setSelected] = useState(null);
  const [showResult, setShowResult] = useState(false);

  const others = allUsers.filter(u => u.id !== currentUser?.uid);

  async function spin() {
    if (spinning || others.length === 0) return;
    setSpinning(true);
    setSelected(null);
    setShowResult(false);
    const extraSpins = 5 + Math.floor(Math.random() * 5);
    const targetIndex = Math.floor(Math.random() * others.length);
    const degreesPerUser = 360 / others.length;
    const finalAngle = extraSpins * 360 + targetIndex * degreesPerUser + Math.random() * degreesPerUser;
    setRotation(prev => prev + finalAngle);
    setTimeout(async () => {
      const winner = others[targetIndex];
      setSelected(winner);
      setSpinning(false);
      setShowResult(true);
      if (onSpun) onSpun(winner);
    }, 3000);
  }

  return (
    <div style={{textAlign:"center",padding:"20px 0"}}>
      <div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:20}}>{l.spinTitle}</div>

      {others.length < 2 ? (
        <div style={{color:"#888",fontSize:14,fontStyle:"italic",padding:20}}>{l.spinMinUsers}</div>
      ) : (
        <>
          <div style={{position:"relative",width:200,height:200,margin:"0 auto 20px"}}>
            {others.slice(0,8).map((u,i) => {
              const angle = (i / Math.min(others.length,8)) * 2 * Math.PI - Math.PI/2;
              const x = 90 + 80 * Math.cos(angle);
              const y = 90 + 80 * Math.sin(angle);
              return (
                <div key={u.id} style={{position:"absolute",left:x,top:y,transform:"translate(-50%,-50%)",fontSize:24,transition:"all 0.3s",opacity:selected&&selected.id===u.id?1:selected?0.3:1}}>
                  {u.emoji}
                </div>
              );
            })}
            <div style={{position:"absolute",top:"50%",left:"50%",transform:`translate(-50%,-50%) rotate(${rotation}deg)`,transformOrigin:"center bottom",transition:spinning?"transform 3s cubic-bezier(0.2,0.8,0.4,1)":"none",fontSize:48,lineHeight:1}}>🍾</div>
            <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",width:12,height:12,borderRadius:"50%",background:"#f5a623",zIndex:2}}/>
          </div>

          <button
            style={{background:spinning?"#333":"linear-gradient(135deg,#f5a623,#e8890a)",border:"none",borderRadius:50,padding:"14px 40px",color:spinning?"#888":"#111",fontWeight:800,fontSize:18,cursor:spinning?"not-allowed":"pointer",fontFamily:"Georgia,serif",transition:"all 0.3s",boxShadow:spinning?"none":"0 4px 20px rgba(245,166,35,0.4)"}}
            onClick={spin} disabled={spinning}>
            {spinning?l.spinning:l.spinBtn}
          </button>

          {showResult && selected && (
            <div style={{marginTop:20,background:"linear-gradient(135deg,#1a1200,#2a2000)",border:"1px solid #f5a623",borderRadius:16,padding:20,animation:"fadeIn 0.5s ease"}}>
              <div style={{fontSize:48,marginBottom:8}}>{selected.emoji}</div>
              <div style={{fontWeight:800,fontSize:20,color:"#f5a623",marginBottom:4}}>🍾 {selected.name}</div>
              <div style={{color:"#888",fontSize:13,marginBottom:16}}>{l.spinChosen}</div>
              <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                <button style={{background:"#f5a623",border:"none",borderRadius:10,padding:"10px 20px",color:"#111",fontWeight:700,cursor:"pointer",fontFamily:"Georgia,serif"}} onClick={()=>{setShowResult(false);setSelected(null);}}>{l.spinAgain}</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===== LIVE MAP COMPONENT =====
function LiveMap({ allUsers, currentUser, geo, onUserClick }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [checkinName, setCheckinName] = useState("");
  const [showCheckin, setShowCheckin] = useState(false);

  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css'; link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if (!window.L) {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => setLeafletLoaded(true);
      document.head.appendChild(script);
    } else { setLeafletLoaded(true); }
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || mapInstanceRef.current) return;
    const center = geo ? [geo.lat, geo.lon] : [44.4268, 26.1025];
    const map = window.L.map(mapRef.current, { zoomControl: true, attributionControl: false }).setView(center, 13);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    mapInstanceRef.current = map;
  }, [leafletLoaded, geo]);

  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;
    const map = mapInstanceRef.current;
    const twoHoursAgo = Date.now() - 2*3600*1000;
    Object.values(markersRef.current).forEach(m => map.removeLayer(m));
    markersRef.current = {};
    allUsers.filter(u => u.lat && u.lon).forEach(u => {
      const isActive = u.lastSeen?.seconds ? (u.lastSeen.seconds*1000 > twoHoursAgo) : false;
      const isMe = u.id === currentUser?.uid;
      const size = isMe ? 44 : isActive ? 38 : 32;
      const checkedIn = u.checkinName ? `<br/><span style="font-size:10px;color:#f5a623">📍 ${u.checkinName}</span>` : '';
      const icon = window.L.divIcon({
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${isMe?'#f5a623':isActive?'#2a2a2a':'#1a1a1a'};border:${isMe?'3px solid #fff':isActive?'2px solid #f5a623':'2px solid #444'};display:flex;align-items:center;justify-content:center;font-size:${isMe?22:isActive?18:16}px;box-shadow:${isMe?'0 0 12px rgba(245,166,35,0.8)':isActive?'0 0 8px rgba(245,166,35,0.4)':'none'};cursor:pointer;">${u.emoji}</div>`,
        className:'', iconSize:[size,size], iconAnchor:[size/2,size/2],
      });
      const marker = window.L.marker([u.lat, u.lon], { icon }).addTo(map)
        .bindPopup(`<div style="font-family:Georgia,serif;text-align:center;min-width:120px"><div style="font-size:28px">${u.emoji}</div><div style="font-weight:700;color:#f5a623;font-size:14px">${u.name}</div><div style="color:#888;font-size:11px">${u.drink}</div>${checkedIn}<div style="color:#aaa;font-size:10px;margin-top:4px">${isActive?'🟢 Activ recent':'⚫ Inactiv'}</div>${!isMe?`<button onclick="window._dbUserClick('${u.id}')" style="margin-top:8px;background:#f5a623;border:none;border-radius:8px;padding:4px 12px;font-size:12px;cursor:pointer;font-family:Georgia,serif">Vezi Profil</button>`:''}</div>`);
      marker.on('click', () => { if (!isMe) onUserClick(u); });
      markersRef.current[u.id] = marker;
    });
    window._dbUserClick = (userId) => { const user = allUsers.find(u => u.id === userId); if (user) onUserClick(user); };
  }, [allUsers, currentUser, leafletLoaded]);

  useEffect(() => { if (geo && mapInstanceRef.current) mapInstanceRef.current.setView([geo.lat, geo.lon], 14); }, [geo]);

  async function handleCheckin() {
    if (!checkinName.trim() || !currentUser) return;
    await updateDoc(doc(db, "users", currentUser.uid), { checkinName, checkinTime: serverTimestamp(), lastSeen: serverTimestamp() });
    setCheckinName(""); setShowCheckin(false);
  }
  async function handleCheckout() {
    if (!currentUser) return;
    await updateDoc(doc(db, "users", currentUser.uid), { checkinName: null, checkinTime: null });
  }

  const myUser = allUsers.find(u => u.id === currentUser?.uid);
  const iS = {width:"100%",boxSizing:"border-box",background:"#1a1a1a",border:"1px solid #333",borderRadius:10,padding:"10px 14px",color:"#e8e0d0",fontSize:15,fontFamily:"Georgia,serif",outline:"none"};

  return (
    <div>
      <div style={{background:"#171717",border:"1px solid #242424",borderRadius:14,padding:12,marginBottom:12}}>
        {myUser?.checkinName ? (
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:20}}>📍</span>
            <div style={{flex:1}}><div style={{color:"#f5a623",fontWeight:700,fontSize:14}}>Check-in: {myUser.checkinName}</div><div style={{color:"#888",fontSize:12}}>{L.checkinActive}</div></div>
            <button style={{background:"#e87070",border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif"}} onClick={handleCheckout}>{L.checkoutBtn}</button>
          </div>
        ) : showCheckin ? (
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input style={{...iS,flex:1,padding:"8px 12px"}} placeholder={L.checkinPlaceholder} value={checkinName} onChange={e=>setCheckinName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleCheckin()} autoFocus/>
            <button style={{background:"#f5a623",border:"none",borderRadius:8,padding:"8px 14px",color:"#111",fontWeight:700,cursor:"pointer",fontFamily:"Georgia,serif"}} onClick={handleCheckin}>✓</button>
            <button style={{background:"#2a2a2a",border:"none",borderRadius:8,padding:"8px 10px",color:"#888",cursor:"pointer"}} onClick={()=>setShowCheckin(false)}>✕</button>
          </div>
        ) : (
          <button style={{background:"none",border:"1px dashed #444",borderRadius:10,padding:"10px",width:"100%",color:"#888",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8}} onClick={()=>setShowCheckin(true)}>{L.checkinBtn}</button>
        )}
      </div>
      {!leafletLoaded&&<div style={{height:400,background:"#171717",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",color:"#888"}}>{L.mapLoading}</div>}
      <div ref={mapRef} style={{height:420,borderRadius:14,overflow:"hidden",display:leafletLoaded?"block":"none"}}/>
      <div style={{display:"flex",gap:12,marginTop:10,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:6,color:"#888",fontSize:12}}><div style={{width:12,height:12,borderRadius:"50%",background:"#f5a623",border:"2px solid #fff"}}/> Tu</div>
        <div style={{display:"flex",alignItems:"center",gap:6,color:"#888",fontSize:12}}><div style={{width:12,height:12,borderRadius:"50%",background:"#2a2a2a",border:"2px solid #f5a623"}}/> Activ</div>
        <div style={{display:"flex",alignItems:"center",gap:6,color:"#888",fontSize:12}}><div style={{width:12,height:12,borderRadius:"50%",background:"#1a1a1a",border:"2px solid #444"}}/> Inactiv</div>
      </div>
      <div style={{marginTop:16}}>
        <div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Pe Hartă ({allUsers.filter(u=>u.lat&&u.lon).length})</div>
        {allUsers.filter(u=>u.lat&&u.lon).map(u=>(
          <div key={u.id} style={{background:"#171717",border:"1px solid #242424",borderRadius:12,padding:10,marginBottom:8,display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={()=>onUserClick(u)}>
            <span style={{fontSize:24}}>{u.emoji}</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:14,color:u.id===currentUser?.uid?"#f5a623":"#e8e0d0"}}>{u.name} {u.id===currentUser?.uid&&"(tu)"}</div>
              {u.checkinName?<div style={{color:"#f5a623",fontSize:12}}>📍 {u.checkinName}</div>:<div style={{color:"#666",fontSize:12}}>Locație activă</div>}
            </div>
            {u.id!==currentUser?.uid&&<div style={{width:8,height:8,borderRadius:"50%",background:u.lastSeen?.seconds&&(Date.now()-u.lastSeen.seconds*1000)<7200000?"#4caf82":"#555"}}/>}
          </div>
        ))}
        {allUsers.filter(u=>u.lat&&u.lon).length===0&&<div style={{textAlign:"center",color:"#666",fontSize:14,fontStyle:"italic",marginTop:20}}>{L.noLocationYet}</div>}
      </div>
    </div>
  );
}

export default function App() {
  const [authUser,setAuthUser]=useState(null);
  const [profile,setProfile]=useState(null);
  const [loading,setLoading]=useState(true);
  const [screen,setScreen]=useState("splash");
  const [tab,setTab]=useState("feed");
  const [authMode,setAuthMode]=useState("login");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [authError,setAuthError]=useState("");
  const [setupStep,setSetupStep]=useState(0);
  const [setupData,setSetupData]=useState({name:"",emoji:"🍺",drink:"",bio:""});
  const [posts,setPosts]=useState([]);
  const [newPost,setNewPost]=useState("");
  const [selectedDrink,setSelectedDrink]=useState("🍺");
  const [selectedSector,setSelectedSector]=useState(null);
  const [filterSector,setFilterSector]=useState(null);
  const [postImage,setPostImage]=useState(null);
  const [postImagePreview,setPostImagePreview]=useState(null);
  const [uploadingPost,setUploadingPost]=useState(false);
  const [geo,setGeo]=useState(null);
  const [geoError,setGeoError]=useState("");
  const [radius,setRadius]=useState(10);
  const [allUsers,setAllUsers]=useState([]);
  const [viewProfile,setViewProfile]=useState(null);
  const [reviewTarget,setReviewTarget]=useState(null);
  const [reviewText,setReviewText]=useState("");
  const [reviewRating,setReviewRating]=useState(5);
  const [hoverRating,setHoverRating]=useState(0);
  const [chatWith,setChatWith]=useState(null);
  const [messages,setMessages]=useState([]);
  const [newMsg,setNewMsg]=useState("");
  const [conversations,setConversations]=useState([]);
  const [unreadCount,setUnreadCount]=useState(0);
  const [toast,setToast]=useState(null);
  const [openComments,setOpenComments]=useState(null);
  const [comments,setComments]=useState({});
  const [newComment,setNewComment]=useState("");
  const [commentImage,setCommentImage]=useState(null);
  const [commentImagePreview,setCommentImagePreview]=useState(null);
  const [uploadingComment,setUploadingComment]=useState(false);
  const [lightboxImg,setLightboxImg]=useState(null);
  const [badgeTooltip,setBadgeTooltip]=useState(null);
  const [searchQuery,setSearchQuery]=useState("");
  const [globalSearch,setGlobalSearch]=useState("");
  const [showGlobalSearch,setShowGlobalSearch]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(null);
  const [editProfile,setEditProfile]=useState(false);
  const [editData,setEditData]=useState({name:"",emoji:"🍺",drink:"",bio:""});
  const [savingProfile,setSavingProfile]=useState(false);
  // Challenges
  const [challenges,setChallenges]=useState([]);
  const [showChallengeModal,setShowChallengeModal]=useState(false);
  const [challengeTarget,setChallengeTarget]=useState(null);
  const [challengeText,setChallengeText]=useState("");
  const [funTab,setFunTab]=useState("challenges"); // challenges | spin
  const [pendingChallenges,setPendingChallenges]=useState(0);
  const [notifPermission,setNotifPermission]=useState(typeof Notification!=="undefined"?Notification.permission:"default");
  const [notifications,setNotifications]=useState([]);
  const [showNotifs,setShowNotifs]=useState(false);
  const [unreadNotifs,setUnreadNotifs]=useState(0);
  const [lang,setLang]=useState(()=>{const saved=localStorage.getItem("db_lang");return saved&&LANGS[saved]?saved:"ro";});
  const L=LANGS[lang];
  const messagesEndRef=useRef(null);
  const commentInputRef=useRef(null);
  const fileInputRef=useRef(null);
  const commentFileInputRef=useRef(null);
  const searchRef=useRef(null);

  useEffect(()=>{
    async function tryAutoLogin(){
      try{
        if(auth.currentUser){
          const snap=await getDoc(doc(db,"users",auth.currentUser.uid));
          if(snap.exists()){setProfile(snap.data());setAuthUser(auth.currentUser);setScreen("app");setLoading(false);return;}
        }
        const savedEmail=getCookie('db_email'),savedPass=getCookie('db_pass');
        if(savedEmail&&savedPass){
          try{
            const cred=await signInWithEmailAndPassword(auth,savedEmail,savedPass);
            const snap=await getDoc(doc(db,"users",cred.user.uid));
            setAuthUser(cred.user);
            if(snap.exists()){setProfile(snap.data());setScreen("app");}
            else{setScreen("setup");setSetupStep(0);}
          }catch(e){deleteCookie('db_email');deleteCookie('db_pass');setScreen("auth");}
        }else{setScreen("auth");}
      }catch(e){setScreen("auth");}
      setLoading(false);
    }
    setTimeout(()=>tryAutoLogin(),2200);
  },[]);

  useEffect(()=>{if(screen!=="app")return;const q=query(collection(db,"posts"),orderBy("createdAt","desc"));return onSnapshot(q,snap=>setPosts(snap.docs.map(d=>({id:d.id,...d.data()}))));},[screen]);
  useEffect(()=>{if(screen!=="app")return;return onSnapshot(collection(db,"users"),snap=>setAllUsers(snap.docs.map(d=>({id:d.id,...d.data()}))));},[screen]);

  useEffect(()=>{
    if(!authUser||screen!=="app")return;
    const q=query(collection(db,"conversations"),where("participants","array-contains",authUser.uid),orderBy("lastMessageAt","desc"));
    return onSnapshot(q,snap=>{
      const convs=snap.docs.map(d=>({id:d.id,...d.data()}));
      setConversations(convs);
      setUnreadCount(convs.filter(c=>c.lastSenderId!==authUser.uid&&!(c.readBy||[]).includes(authUser.uid)).length);
    });
  },[authUser,screen]);

  useEffect(()=>{
    if(!chatWith||!authUser)return;
    const chatId=getChatId(authUser.uid,chatWith.id);
    const q=query(collection(db,"chats",chatId,"messages"),orderBy("createdAt","asc"));
    const unsub=onSnapshot(q,snap=>{setMessages(snap.docs.map(d=>({id:d.id,...d.data()})));setTimeout(()=>messagesEndRef.current?.scrollIntoView({behavior:"smooth"}),100);});
    getDoc(doc(db,"conversations",chatId)).then(s=>{if(s.exists()){const rb=s.data().readBy||[];if(!rb.includes(authUser.uid))updateDoc(doc(db,"conversations",chatId),{readBy:[...rb,authUser.uid]});}});
    return unsub;
  },[chatWith,authUser]);

  useEffect(()=>{
    if(!openComments)return;
    const q=query(collection(db,"posts",openComments,"comments"),orderBy("createdAt","asc"));
    return onSnapshot(q,snap=>{setComments(c=>({...c,[openComments]:snap.docs.map(d=>({id:d.id,...d.data()}))}));});
  },[openComments]);

  useEffect(()=>{
    if(!authUser||screen!=="app")return;
    const update=()=>updateDoc(doc(db,"users",authUser.uid),{lastSeen:serverTimestamp(),online:true}).catch(()=>{});
    update();
    const interval=setInterval(update,60*1000);
    // Mark offline when tab hidden
    const onHide=()=>updateDoc(doc(db,"users",authUser.uid),{online:false}).catch(()=>{});
    const onShow=()=>update();
    document.addEventListener("visibilitychange",()=>document.hidden?onHide():onShow());
    window.addEventListener("beforeunload",onHide);
    return()=>{
      clearInterval(interval);
      document.removeEventListener("visibilitychange",()=>document.hidden?onHide():onShow());
      window.removeEventListener("beforeunload",onHide);
      onHide();
    };
  },[authUser,screen]);

  // Listen to challenges
  useEffect(()=>{
    if(!authUser||screen!=="app")return;
    const q=query(collection(db,"challenges"),orderBy("createdAt","desc"));
    return onSnapshot(q,snap=>{
      const all=snap.docs.map(d=>({id:d.id,...d.data()}));
      setChallenges(all);
      setPendingChallenges(all.filter(c=>c.toId===authUser.uid&&c.status==="pending").length);
    });
  },[authUser,screen]);

  useEffect(()=>{if(showGlobalSearch)setTimeout(()=>searchRef.current?.focus(),100);},[showGlobalSearch]);

  // Listen for in-app notifications from Firestore
  useEffect(()=>{
    if(!authUser||screen!=="app")return;
    const q=query(collection(db,"notifications"),where("toId","==",authUser.uid),orderBy("createdAt","desc"));
    return onSnapshot(q,snap=>{
      const notifs=snap.docs.map(d=>({id:d.id,...d.data()}));
      setNotifications(notifs);
      setUnreadNotifs(notifs.filter(n=>!n.read).length);
    });
  },[authUser,screen]);

  // Listen for foreground notifications
  useEffect(()=>{
    if(!messaging)return;
    const unsub=onMessage(messaging,(payload)=>{
      const title=payload.notification?.title||"🍺 DrunkBook";
      const body=payload.notification?.body||"Ai un mesaj nou!";
      showToast(`🔔 ${body}`);
    });
    return unsub;
  },[]);

  async function enableNotifications(){
    try{
      const token=await requestNotificationPermission();
      setNotifPermission(Notification.permission);
      if(token&&authUser){
        await updateDoc(doc(db,"users",authUser.uid),{fcmToken:token,notificationsEnabled:true});
        showToast(L.notifsEnabled);
      }else if(Notification.permission==="denied"){
        showToast("Notificările sunt blocate în browser! ❌");
      }
    }catch(e){
      showToast("Eroare la activarea notificărilor");
    }
  }

  async function disableNotifications(){
    if(authUser){
      await updateDoc(doc(db,"users",authUser.uid),{fcmToken:null,notificationsEnabled:false});
      setNotifPermission("denied");
      showToast(L.notifsDisabled);
    }
  }

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(null),2800);}

  function changeLang(l){setLang(l);localStorage.setItem("db_lang",l);}

  async function markNotifsRead(){
    const unread=notifications.filter(n=>!n.read);
    for(const n of unread){
      await updateDoc(doc(db,"notifications",n.id),{read:true}).catch(()=>{});
    }
  }

  async function handleAuth(){
    try{
      let user;
      if(authMode==="register"){const cred=await createUserWithEmailAndPassword(auth,email,password);user=cred.user;}
      else{const cred=await signInWithEmailAndPassword(auth,email,password);user=cred.user;}
      setCookie('db_email',email);setCookie('db_pass',password);setAuthUser(user);
      const snap=await getDoc(doc(db,"users",user.uid));
      if(snap.exists()){setProfile(snap.data());setScreen("app");}
      else{setScreen("setup");setSetupStep(0);}
    }catch(e){
      const msgs={"auth/email-already-in-use":L.emailInUse,"auth/weak-password":L.weakPassword,"auth/invalid-email":L.invalidEmail,"auth/invalid-credential":L.invalidCredential};
      setAuthError(msgs[e.code]||e.message);
    }
  }

  async function handleSetupNext(){
    if(setupStep===0&&!setupData.name.trim())return;
    if(setupStep<3){setSetupStep(s=>s+1);return;}
    const userData={uid:authUser.uid,email:authUser.email,name:setupData.name,emoji:setupData.emoji,drink:setupData.drink||"Ceva tare",bio:setupData.bio||"Omul misterios de la bar.",avgRating:0,totalRatings:0,ratings:[],lat:null,lon:null,challengesAccepted:0,createdAt:serverTimestamp()};
    await setDoc(doc(db,"users",authUser.uid),userData);
    setProfile(userData);setScreen("app");
  }

  function requestGeo(){
    if(!navigator.geolocation){setGeoError(L.noLocationSupport);return;}
    navigator.geolocation.getCurrentPosition(async(pos)=>{
      const{latitude:lat,longitude:lon}=pos.coords;
      setGeo({lat,lon});
      if(authUser){await updateDoc(doc(db,"users",authUser.uid),{lat,lon,lastSeen:serverTimestamp()});setProfile(p=>({...p,lat,lon}));}
    },()=>setGeoError("Nu ai dat acces la locație."));
  }

  function handleImageSelect(e){const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024){showToast(L.photoTooBig);return;}setPostImage(file);setPostImagePreview(URL.createObjectURL(file));}
  function removeImage(){setPostImage(null);setPostImagePreview(null);if(fileInputRef.current)fileInputRef.current.value="";}

  async function submitPost(){
    if(!newPost.trim()&&!postImage)return;
    setUploadingPost(true);
    try{
      let imageUrl=null;
      if(postImage){
        showToast("Se încarcă poza... 📸");
        try{
          imageUrl=await uploadToImgbb(postImage);
        }catch(e){
          showToast("Eroare upload poză: "+e.message);
          setUploadingPost(false);
          return;
        }
      }
      await addDoc(collection(db,"posts"),{userId:authUser.uid,userName:profile.name,userEmoji:profile.emoji,text:newPost,drink:selectedDrink,sector:selectedSector||null,likes:[],commentCount:0,imageUrl,createdAt:serverTimestamp()});
      setNewPost("");removeImage();setSelectedSector(null);showToast(L.postPublished);
    }catch(e){showToast("Eroare: "+e.message);}
    setUploadingPost(false);
  }

  async function toggleLike(postId,likes){
    const uid=authUser.uid;
    const alreadyLiked=likes.includes(uid);
    await updateDoc(doc(db,"posts",postId),{likes:alreadyLiked?likes.filter(l=>l!==uid):[...likes,uid]});
    if(!alreadyLiked){
      const post=posts.find(p=>p.id===postId);
      if(post&&post.userId!==uid){
        await addDoc(collection(db,"notifications"),{toId:post.userId,fromId:uid,fromName:profile.name,fromEmoji:profile.emoji,type:"cheers",text:`${profile.name} ți-a dat cheers la postarea ta! 🍻`,read:false,createdAt:serverTimestamp()});
      }
    }
  }
  async function deletePost(postId){await deleteDoc(doc(db,"posts",postId));setConfirmDelete(null);showToast(L.postDeleted);}

  async function submitComment(postId){
    if(!newComment.trim()&&!commentImage)return;
    setUploadingComment(true);
    try{
      let imageUrl=null;
      if(commentImage){
        showToast("Se încarcă poza... 📸");
        try{ imageUrl=await uploadToImgbb(commentImage); }
        catch(e){ showToast(L.uploadError+e.message); setUploadingComment(false); return; }
      }
      await addDoc(collection(db,"posts",postId,"comments"),{userId:authUser.uid,userName:profile.name,userEmoji:profile.emoji,text:newComment,imageUrl,createdAt:serverTimestamp()});
      await updateDoc(doc(db,"posts",postId),{commentCount:(posts.find(p=>p.id===postId)?.commentCount||0)+1});
      // Notificare pentru autorul postării
      const post=posts.find(p=>p.id===postId);
      if(post&&post.userId!==authUser.uid){
        await sendInAppNotification(post.userId,"comment",`${profile.name} a comentat la postarea ta: "${newComment.slice(0,50)}${newComment.length>50?"...":""}`);
      }
      setNewComment("");
      setCommentImage(null);setCommentImagePreview(null);
      if(commentFileInputRef.current)commentFileInputRef.current.value="";
      showToast(L.commentAdded);
    }catch(e){showToast("Eroare: "+e.message);}
    setUploadingComment(false);
  }

  async function submitReview(){
    if(!reviewText.trim())return;
    const review={from:authUser.uid,fromName:profile.name,text:reviewText,rating:reviewRating,time:Date.now()};
    const newRatings=[...(reviewTarget.ratings||[]),review];
    const avg=newRatings.reduce((s,r)=>s+r.rating,0)/newRatings.length;
    await updateDoc(doc(db,"users",reviewTarget.id),{ratings:newRatings,avgRating:Math.round(avg*10)/10,totalRatings:newRatings.length});
    setReviewTarget(null);setReviewText("");setReviewRating(5);showToast(L.reviewSent);
  }

  async function sendInAppNotification(toUserId, type, text){
    try{
      await addDoc(collection(db,"notifications"),{
        toId:toUserId,fromId:authUser.uid,fromName:profile.name,fromEmoji:profile.emoji,
        type,text,read:false,createdAt:serverTimestamp(),
      });
    }catch(e){console.log("Notif error:",e);}
  }

  async function sendMessage(){
    if(!newMsg.trim()||!chatWith)return;
    const chatId=getChatId(authUser.uid,chatWith.id);
    await addDoc(collection(db,"chats",chatId,"messages"),{text:newMsg,senderId:authUser.uid,senderName:profile.name,senderEmoji:profile.emoji,createdAt:serverTimestamp()});
    await setDoc(doc(db,"conversations",chatId),{participants:[authUser.uid,chatWith.id],participantNames:{[authUser.uid]:profile.name,[chatWith.id]:chatWith.name},participantEmojis:{[authUser.uid]:profile.emoji,[chatWith.id]:chatWith.emoji},lastMessage:newMsg,lastSenderId:authUser.uid,lastMessageAt:serverTimestamp(),readBy:[authUser.uid]},{merge:true});
    setNewMsg("");
    sendInAppNotification(chatWith.id,"message",`${profile.name} ți-a trimis un mesaj: "${newMsg.slice(0,50)}${newMsg.length>50?"...":""}"`);
  }

  async function saveProfile(){
    if(!editData.name.trim())return;
    setSavingProfile(true);
    await updateDoc(doc(db,"users",authUser.uid),{name:editData.name,emoji:editData.emoji,drink:editData.drink||"Ceva tare",bio:editData.bio||"Omul misterios de la bar."});
    setProfile(p=>({...p,...editData}));
    setEditProfile(false);setSavingProfile(false);showToast(L.profileUpdated);
  }

  function openEditProfile(){
    setEditData({name:profile.name||"",emoji:profile.emoji||"🍺",drink:profile.drink||"",bio:profile.bio||""});
    setEditProfile(true);
  }

  // Challenge functions
  async function sendChallenge(){
    if(!challengeText.trim()||!challengeTarget)return;
    await addDoc(collection(db,"challenges"),{
      fromId:authUser.uid,fromName:profile.name,fromEmoji:profile.emoji,
      toId:challengeTarget.id,toName:challengeTarget.name,toEmoji:challengeTarget.emoji,
      text:challengeText,status:"pending",createdAt:serverTimestamp(),
    });
    setShowChallengeModal(false);setChallengeText("");setChallengeTarget(null);
    showToast(`Provocare trimisă lui ${challengeTarget.name}! 🎯`);
    sendInAppNotification(challengeTarget.id,"challenge",`${profile.name} te provoacă: "${challengeText.slice(0,50)}${challengeText.length>50?"...":""}"`);
  }

  async function respondChallenge(challengeId,accept){
    await updateDoc(doc(db,"challenges",challengeId),{
      status:accept?"accepted":"declined",respondedAt:serverTimestamp(),
    });
    if(accept){
      await updateDoc(doc(db,"users",authUser.uid),{challengesAccepted:(profile.challengesAccepted||0)+1});
      setProfile(p=>({...p,challengesAccepted:(p.challengesAccepted||0)+1}));
      showToast(L.challengeAccepted);
    }else{
      showToast(L.challengeDeclined);
    }
  }

  async function completeChallenge(challengeId){
    await updateDoc(doc(db,"challenges",challengeId),{status:"completed",completedAt:serverTimestamp()});
    showToast("Provocare completată! 🏆+5 puncte");
  }

  function openChat(user){setChatWith(user);setViewProfile(null);setTab("messages");}
  async function handleSignOut(){deleteCookie('db_email');deleteCookie('db_pass');await signOut(auth);setScreen("auth");setProfile(null);setAuthUser(null);}

  const leaderboard=allUsers.map(u=>{
    const uPosts=posts.filter(p=>p.userId===u.id);
    const totalLikes=uPosts.reduce((s,p)=>s+(p.likes||[]).length,0);
    const totalPosts=uPosts.length;
    const totalComments=uPosts.reduce((s,p)=>s+(p.commentCount||0),0);
    const completedChallenges=challenges.filter(c=>(c.fromId===u.id||c.toId===u.id)&&c.status==="completed").length;
    const score=totalLikes*3+totalPosts*2+totalComments+(u.totalRatings||0)*2+completedChallenges*5;
    const badges=computeBadges({...u,id:u.id},posts,allUsers);
    return{...u,totalLikes,totalPosts,totalComments,score,badges};
  }).sort((a,b)=>b.score-a.score);

  const myStats=leaderboard.find(u=>u.id===authUser?.uid);
  const myRank=leaderboard.findIndex(u=>u.id===authUser?.uid)+1;
  const nearbyUsers=allUsers.filter(u=>u.id!==authUser?.uid&&u.lat&&geo&&distKm(geo.lat,geo.lon,u.lat,u.lon)<=radius);
  const searchResults=globalSearch.trim()?allUsers.filter(u=>u.name?.toLowerCase().includes(globalSearch.toLowerCase())||u.drink?.toLowerCase().includes(globalSearch.toLowerCase())||u.bio?.toLowerCase().includes(globalSearch.toLowerCase())):[];
  const filteredUsers=allUsers.filter(u=>u.id!==authUser?.uid).filter(u=>!searchQuery||u.name?.toLowerCase().includes(searchQuery.toLowerCase())||u.drink?.toLowerCase().includes(searchQuery.toLowerCase()));

  const myChallenges=challenges.filter(c=>c.fromId===authUser?.uid||c.toId===authUser?.uid);

  if(screen==="splash")return(<div style={S.splash}><div style={S.splashGlow}/><div style={{textAlign:"center",zIndex:1}}><div style={{fontSize:72,marginBottom:12}}>🍺</div><div style={S.splashTitle}>DRUNKBOOK</div><div style={{color:"#888",fontSize:13,marginTop:8,letterSpacing:2}}>{L.appTagline}</div><div style={S.splashLoader}><div style={S.splashBar}/></div></div></div>);
  if(loading)return(<div style={{...S.splash}}><div style={{fontSize:40}}>🍺</div><div style={{color:"#f5a623",marginTop:12}}>{L.uploading}</div></div>);

  if(screen==="auth")return(
    <div style={S.root}><div style={S.loginWrap}>
      <div style={{fontSize:56,textAlign:"center"}}>🍺</div>
      <div style={S.splashTitle}>DRUNKBOOK</div>
      <div style={{textAlign:"center",color:"#888",fontSize:13,fontStyle:"italic",marginBottom:8}}>{L.appTagline2}</div>
      <div style={S.authTabs}><button style={{...S.authTab,...(authMode==="login"?S.authTabActive:{})}} onClick={()=>setAuthMode("login")}>{L.login}</button><button style={{...S.authTab,...(authMode==="register"?S.authTabActive:{})}} onClick={()=>setAuthMode("register")}>{L.register}</button></div>
      <input style={S.input} type="email" placeholder={L.email} value={email} onChange={e=>setEmail(e.target.value)}/>
      <input style={S.input} type="password" placeholder={L.password} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAuth()}/>
      {authError&&<div style={{color:"#e87070",fontSize:13,textAlign:"center"}}>{authError}</div>}
      <button style={S.btnPrimary} onClick={handleAuth}>{authMode==="login"?L.loginBtn:L.registerBtn}</button>
    </div></div>
  );

  if(screen==="setup")return(
    <div style={S.root}><div style={S.loginWrap}>
      <div style={S.setupHeader}><button style={S.backBtn} onClick={()=>setupStep>0&&setSetupStep(s=>s-1)}>←</button><span style={{color:"#888",fontSize:13}}>{L.step} {setupStep+1} {L.of} 4</span></div>
      {setupStep===0&&<><div style={S.setupQ}>{L.setupName}</div><input style={S.input} placeholder={L.setupNamePlaceholder} value={setupData.name} onChange={e=>setSetupData(d=>({...d,name:e.target.value}))} autoFocus/></>}
      {setupStep===1&&<><div style={S.setupQ}>{L.setupEmoji}</div><div style={S.emojiGrid}>{DRINKS.map(e=><button key={e} style={{...S.emojiBtn,...(setupData.emoji===e?S.emojiBtnActive:{})}} onClick={()=>setSetupData(d=>({...d,emoji:e}))}>{e}</button>)}</div></>}
      {setupStep===2&&<><div style={S.setupQ}>{L.setupDrink}</div><input style={S.input} placeholder={L.setupDrinkPlaceholder} value={setupData.drink} onChange={e=>setSetupData(d=>({...d,drink:e.target.value}))} autoFocus/></>}
      {setupStep===3&&<><div style={S.setupQ}>{L.setupBio}</div><textarea style={{...S.input,height:100,resize:"none"}} placeholder={L.setupBioPlaceholder} value={setupData.bio} onChange={e=>setSetupData(d=>({...d,bio:e.target.value}))} autoFocus/></>}
      <button style={S.btnPrimary} onClick={handleSetupNext}>{setupStep<3?L.continue:L.enterBar}</button>
    </div></div>
  );

  return(
    <div style={S.root}>
      {toast&&<div style={S.toast}>{toast}</div>}
      {lightboxImg&&(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.95)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setLightboxImg(null)}><img src={lightboxImg} alt="" style={{maxWidth:"95vw",maxHeight:"90vh",borderRadius:12,objectFit:"contain"}}/><button style={{position:"absolute",top:20,right:20,background:"#2a2a2a",border:"none",color:"#fff",width:36,height:36,borderRadius:"50%",fontSize:18,cursor:"pointer"}}>✕</button></div>)}
      {badgeTooltip&&(<div style={{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:"#1a1a1a",border:"1px solid #f5a623",borderRadius:16,padding:20,zIndex:400,textAlign:"center",minWidth:200}} onClick={()=>setBadgeTooltip(null)}><div style={{fontSize:48,marginBottom:8}}>{badgeTooltip.icon}</div><div style={{fontWeight:700,color:"#f5a623",fontSize:16,marginBottom:6}}>{badgeTooltip.name}</div><div style={{color:"#aaa",fontSize:13}}>{badgeTooltip.desc}</div><div style={{color:"#666",fontSize:11,marginTop:12}}>Apasă pentru a închide</div></div>)}

      {/* Edit Profile */}
      {editProfile&&(<div style={S.modal} onClick={()=>setEditProfile(false)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}>
        <button style={S.modalClose} onClick={()=>setEditProfile(false)}>✕</button>
        <div style={{fontSize:18,fontWeight:700,color:"#f5a623",marginBottom:20,textAlign:"center"}}>{L.editProfile}</div>
        <div style={{marginBottom:14}}><div style={{color:"#888",fontSize:12,marginBottom:6}}>Emoji</div><div style={S.emojiGrid}>{DRINKS.map(e=><button key={e} style={{...S.emojiBtn,...(editData.emoji===e?S.emojiBtnActive:{})}} onClick={()=>setEditData(d=>({...d,emoji:e}))}>{e}</button>)}</div></div>
        <div style={{marginBottom:14}}><div style={{color:"#888",fontSize:12,marginBottom:6}}>Nume</div><input style={S.input} placeholder="Numele tău de bar..." value={editData.name} onChange={e=>setEditData(d=>({...d,name:e.target.value}))}/></div>
        <div style={{marginBottom:14}}><div style={{color:"#888",fontSize:12,marginBottom:6}}>Băutura favorită</div><input style={S.input} placeholder="ex: Bere, Whisky..." value={editData.drink} onChange={e=>setEditData(d=>({...d,drink:e.target.value}))}/></div>
        <div style={{marginBottom:20}}><div style={{color:"#888",fontSize:12,marginBottom:6}}>Bio</div><textarea style={{...S.input,height:90,resize:"none"}} placeholder="Spune ceva despre tine..." value={editData.bio} onChange={e=>setEditData(d=>({...d,bio:e.target.value}))}/></div>
        <button style={{...S.btnPrimary,opacity:savingProfile?0.6:1}} onClick={saveProfile} disabled={savingProfile}>{savingProfile?L.saving:L.saveProfile}</button>
      </div></div>)}

      {/* Confirm Delete */}
      {confirmDelete&&(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}><div style={{background:"#1a1a1a",border:"1px solid #e87070",borderRadius:16,padding:24,maxWidth:300,width:"100%",textAlign:"center"}}>
        <div style={{fontSize:36,marginBottom:12}}>🗑️</div>
        <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>{L.deletePost}</div>
        <div style={{color:"#888",fontSize:13,marginBottom:20}}>{L.deletePostDesc}</div>
        <div style={{display:"flex",gap:10}}>
          <button style={{flex:1,background:"#2a2a2a",border:"none",borderRadius:10,padding:"12px",color:"#ccc",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14}} onClick={()=>setConfirmDelete(null)}>{L.cancel}</button>
          <button style={{flex:1,background:"#e87070",border:"none",borderRadius:10,padding:"12px",color:"#fff",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14,fontWeight:700}} onClick={()=>deletePost(confirmDelete)}>Șterge</button>
        </div>
      </div></div>)}

      {/* Send Challenge Modal */}
      {showChallengeModal&&(<div style={S.modal} onClick={()=>setShowChallengeModal(false)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}>
        <button style={S.modalClose} onClick={()=>setShowChallengeModal(false)}>✕</button>
        <div style={{fontSize:18,fontWeight:700,color:"#f5a623",marginBottom:16,textAlign:"center"}}>🎯 Trimite o Provocare</div>
        {!challengeTarget?(
          <div>
            <div style={{color:"#888",fontSize:13,marginBottom:10}}>Alege cine primește provocarea:</div>
            {allUsers.filter(u=>u.id!==authUser?.uid).map(u=>(<div key={u.id} style={{...S.nearbyCard,cursor:"pointer",marginBottom:8}} onClick={()=>setChallengeTarget(u)}>
              <span style={{fontSize:28}}>{u.emoji}</span>
              <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14}}>{u.name}</div><div style={{color:"#888",fontSize:12}}>{u.drink}</div></div>
              <span style={{color:"#f5a623",fontSize:18}}>→</span>
            </div>))}
          </div>
        ):(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,background:"#1a1a1a",borderRadius:12,padding:12}}>
              <span style={{fontSize:28}}>{challengeTarget.emoji}</span>
              <div><div style={{fontWeight:700,color:"#f5a623"}}>{challengeTarget.name}</div><div style={{color:"#888",fontSize:12}}>va primi provocarea</div></div>
              <button style={{marginLeft:"auto",background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:14}} onClick={()=>setChallengeTarget(null)}>✕</button>
            </div>
            <div style={{color:"#888",fontSize:12,marginBottom:8}}>Provocări rapide:</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
              {CHALLENGE_TEMPLATES.map((t,i)=><button key={i} style={{background:"#1e1e1e",border:"1px solid #333",borderRadius:20,padding:"6px 10px",color:"#ccc",cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif"}} onClick={()=>setChallengeText(t)}>{t.slice(0,25)}...</button>)}
            </div>
            <textarea style={{...S.input,height:80,resize:"none",marginBottom:12}} placeholder="Sau scrie propria provocare..." value={challengeText} onChange={e=>setChallengeText(e.target.value)}/>
            <button style={S.btnPrimary} onClick={sendChallenge}>{L.sendChallengeBtn}</button>
          </div>
        )}
      </div></div>)}

      {/* Global Search */}
      {showGlobalSearch&&(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.95)",zIndex:300,padding:20}} onClick={()=>{setShowGlobalSearch(false);setGlobalSearch("");}}>
        <div onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",gap:10,marginBottom:16,marginTop:50}}>
            <input ref={searchRef} style={{...S.input,flex:1,fontSize:18,padding:"14px 16px"}} placeholder={L.searchPlaceholder} value={globalSearch} onChange={e=>setGlobalSearch(e.target.value)} autoFocus/>
            <button style={{background:"#2a2a2a",border:"none",borderRadius:10,padding:"14px 16px",color:"#888",cursor:"pointer",fontSize:16}} onClick={()=>{setShowGlobalSearch(false);setGlobalSearch("");}}>✕</button>
          </div>
          {globalSearch&&searchResults.length===0&&<div style={{textAlign:"center",color:"#666",fontSize:16,marginTop:40,fontStyle:"italic"}}>{L.noUserFound}</div>}
          {searchResults.map(u=>(<div key={u.id} style={{background:"#171717",border:"1px solid #242424",borderRadius:14,padding:14,marginBottom:10,display:"flex",alignItems:"center",gap:12,cursor:"pointer"}} onClick={()=>{setViewProfile(u);setShowGlobalSearch(false);setGlobalSearch("");}}>
            <span style={{fontSize:32}}>{u.emoji}</span>
            <div style={{flex:1}}><div style={{fontWeight:700,fontSize:16,color:"#f5a623"}}>{u.name}</div><div style={{color:"#888",fontSize:13}}>{u.drink}</div></div>
            <div style={{textAlign:"right"}}><div style={{color:"#f5a623",fontSize:13}}>{"★".repeat(Math.round(u.avgRating||0))}</div><div style={{color:"#888",fontSize:11}}>{u.totalRatings||0} recenzii</div></div>
          </div>))}
          {!globalSearch&&<div style={{textAlign:"center",color:"#555",fontSize:14,marginTop:60,fontStyle:"italic"}}>{L.searchHint}</div>}
        </div>
      </div>)}

      <div style={S.header}>
        <span style={{fontWeight:900,fontSize:18,letterSpacing:3,color:"#f5a623"}}>🍺 DRUNKBOOK</span>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {/* Lang selector */}
          <div style={{display:"flex",background:"#1a1a1a",borderRadius:20,padding:2,gap:2}}>
            {Object.entries(LANGS).map(([key,val])=>(
              <button key={key} style={{background:lang===key?"#f5a623":"none",border:"none",borderRadius:18,padding:"4px 7px",cursor:"pointer",fontSize:14,fontWeight:lang===key?700:400,transition:"all 0.2s"}} onClick={()=>changeLang(key)} title={val.name}>{val.flag}</button>
            ))}
          </div>
          <button style={{background:"#1e1e1e",border:"1px solid #2a2a2a",borderRadius:"50%",width:38,height:38,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#888"}} onClick={()=>setShowGlobalSearch(true)}>🔍</button>
          <div style={{position:"relative"}}>
            <button style={{background:"#1e1e1e",border:"1px solid #2a2a2a",borderRadius:"50%",width:38,height:38,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#888"}} onClick={()=>{setShowNotifs(v=>!v);if(!showNotifs)markNotifsRead();}}>🔔</button>
            {unreadNotifs>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#e87070",color:"#fff",borderRadius:"50%",width:18,height:18,fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,pointerEvents:"none"}}>{unreadNotifs>9?"9+":unreadNotifs}</span>}
          </div>
          <button style={S.avatarBtn} onClick={()=>setViewProfile({...profile,id:authUser.uid})}>{profile?.emoji}</button>
        </div>
      </div>

      {/* Notifications Dropdown */}
      {showNotifs&&(<div style={{position:"fixed",top:62,right:8,width:320,maxWidth:"calc(100vw - 16px)",background:"#141414",border:"1px solid #2a2a2a",borderRadius:16,zIndex:150,boxShadow:"0 8px 32px rgba(0,0,0,0.6)",maxHeight:420,overflow:"hidden",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"14px 16px",borderBottom:"1px solid #242424",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontWeight:700,color:"#f5a623",fontSize:15}}>{L.notifications}</span>
          <button style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:14}} onClick={()=>setShowNotifs(false)}>✕</button>
        </div>
        <div style={{overflowY:"auto",flex:1}}>
          {notifications.length===0&&<div style={{padding:24,textAlign:"center",color:"#666",fontStyle:"italic",fontSize:14}}>{L.noNotifs}</div>}
          {notifications.map(n=>(
            <div key={n.id} style={{padding:"12px 16px",borderBottom:"1px solid #1e1e1e",display:"flex",gap:10,alignItems:"flex-start",background:n.read?"transparent":"rgba(245,166,35,0.05)",cursor:"pointer"}} onClick={()=>{setShowNotifs(false);if(n.type==="message"){const u=allUsers.find(u=>u.id===n.fromId);if(u)openChat(u);}else if(n.type==="challenge"){setTab("fun");setFunTab("challenges");}else{setTab("feed");}}}>
              <span style={{fontSize:24,flexShrink:0}}>{n.fromEmoji||"🍺"}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:n.read?"#aaa":"#e8e0d0",lineHeight:1.5}}>{n.text}</div>
                <div style={{fontSize:11,color:"#666",marginTop:4}}>{timeAgo(n.createdAt,L)}</div>
              </div>
              {!n.read&&<div style={{width:8,height:8,borderRadius:"50%",background:"#f5a623",flexShrink:0,marginTop:4}}/>}
            </div>
          ))}
        </div>
        {notifications.length>0&&<div style={{padding:"10px 16px",borderTop:"1px solid #242424",textAlign:"center"}}>
          <button style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:12}} onClick={async()=>{for(const n of notifications)await updateDoc(doc(db,"notifications",n.id),{read:true}).catch(()=>{});}}>{L.markAllRead}</button>
        </div>}
      </div>)}
      {showNotifs&&<div style={{position:"fixed",inset:0,zIndex:149}} onClick={()=>setShowNotifs(false)}/>}

      <div style={S.content}>

        {/* FEED */}
        {tab==="feed"&&(<div>
          <div style={S.composer}>
            <div style={{display:"flex",gap:10,marginBottom:10}}><span style={{fontSize:28}}>{profile?.emoji}</span><textarea style={S.composerInput} placeholder={L.composerPlaceholder} value={newPost} onChange={e=>setNewPost(e.target.value)} rows={2}/></div>
            {postImagePreview&&(<div style={{position:"relative",marginBottom:10}}><img src={postImagePreview} alt="" style={{width:"100%",maxHeight:200,objectFit:"cover",borderRadius:10}}/><button onClick={removeImage} style={{position:"absolute",top:6,right:6,background:"rgba(0,0,0,0.7)",border:"none",color:"#fff",width:28,height:28,borderRadius:"50%",cursor:"pointer",fontSize:14}}>✕</button></div>)}

            {/* Sector selector */}
            <div style={{marginBottom:10}}>
              <div style={{color:"#666",fontSize:12,marginBottom:6}}>📍 Sector (opțional):</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {SECTORS.map(s=>(
                  <button key={s.id} style={{background:selectedSector===s.id?"#2a2000":"#1a1a1a",border:`1px solid ${selectedSector===s.id?"#f5a623":"#333"}`,borderRadius:20,padding:"5px 10px",color:selectedSector===s.id?"#f5a623":"#888",cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif",display:"flex",alignItems:"center",gap:4}} onClick={()=>setSelectedSector(selectedSector===s.id?null:s.id)}>
                    <span>{s.emoji}</span><span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
                {DRINKS.map(d=><button key={d} style={{...S.drinkBtn,...(selectedDrink===d?S.drinkBtnActive:{})}} onClick={()=>setSelectedDrink(d)}>{d}</button>)}
                <button style={{...S.drinkBtn,color:"#f5a623",borderColor:"#f5a623",fontSize:18}} onClick={()=>fileInputRef.current?.click()}>📸</button>
                <input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImageSelect}/>
              </div>
              <button style={{...S.postBtn,opacity:uploadingPost?0.6:1}} onClick={submitPost} disabled={uploadingPost}>{uploadingPost?L.uploading:L.post}</button>
            </div>
          </div>

          {/* Filter bar */}
          <div style={{marginBottom:12,overflowX:"auto",display:"flex",gap:6,paddingBottom:4}}>
            <button style={{background:filterSector===null?"#f5a623":"#1a1a1a",border:`1px solid ${filterSector===null?"#f5a623":"#333"}`,borderRadius:20,padding:"6px 14px",color:filterSector===null?"#111":"#888",cursor:"pointer",fontSize:13,fontFamily:"Georgia,serif",whiteSpace:"nowrap",fontWeight:filterSector===null?700:400}} onClick={()=>setFilterSector(null)}>
              🌍 Toate
            </button>
            {SECTORS.map(s=>(
              <button key={s.id} style={{background:filterSector===s.id?"#f5a623":"#1a1a1a",border:`1px solid ${filterSector===s.id?"#f5a623":"#333"}`,borderRadius:20,padding:"6px 12px",color:filterSector===s.id?"#111":"#888",cursor:"pointer",fontSize:13,fontFamily:"Georgia,serif",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:4,fontWeight:filterSector===s.id?700:400}} onClick={()=>setFilterSector(filterSector===s.id?null:s.id)}>
                <span>{s.emoji}</span><span>{s.label}</span>
              </button>
            ))}
          </div>
          {posts.filter(p=>!filterSector||p.sector===filterSector).map(post=>(
            <div key={post.id} style={S.postCard}>
              <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
                <button style={S.postAvatar} onClick={()=>{const u=allUsers.find(u=>u.id===post.userId);if(u)setViewProfile(u);}}>{post.userEmoji}</button>
                <div style={{flex:1}}><div style={{fontWeight:700,fontSize:15,color:"#f5a623"}}>{post.userName}</div><div style={{color:"#666",fontSize:12,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>{post.drink} · {timeAgo(post.createdAt,L)}{post.sector&&(()=>{const s=SECTORS.find(x=>x.id===post.sector);return s?<span style={{background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:10,padding:"1px 7px",color:"#f5a623",fontSize:11,display:"inline-flex",alignItems:"center",gap:3}}>{s.emoji} {s.label}</span>:null;})()}{(()=>{const u=allUsers.find(u=>u.id===post.userId);const st=getStatus(u,L);return st?<span style={{display:"inline-flex",alignItems:"center",gap:3}}><span style={{width:6,height:6,borderRadius:"50%",background:st.dot,display:"inline-block"}}/></span>:null;})()}</div></div>
                {post.userId!==authUser.uid&&<button style={{background:"none",border:"none",cursor:"pointer",fontSize:18,padding:"4px 8px"}} onClick={()=>{const u=allUsers.find(u=>u.id===post.userId);if(u)openChat(u);}}>💬</button>}
                {post.userId===authUser.uid&&<button style={{background:"none",border:"none",cursor:"pointer",fontSize:16,padding:"4px 8px",color:"#666"}} onClick={()=>setConfirmDelete(post.id)}>🗑️</button>}
              </div>
              {post.text&&<div style={{fontSize:15,lineHeight:1.6,color:"#ddd",marginBottom:post.imageUrl?10:12}}>{post.text}</div>}
              {post.imageUrl&&(<div style={{marginBottom:12,cursor:"pointer"}} onClick={()=>setLightboxImg(post.imageUrl)}><img src={post.imageUrl} alt="" style={{width:"100%",maxHeight:300,objectFit:"cover",borderRadius:10}}/></div>)}
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button style={S.likeBtn} onClick={()=>toggleLike(post.id,post.likes||[])}>🍻 {(post.likes||[]).length}{(post.likes||[]).includes(authUser.uid)?" · cheers!":""}</button>
                <button style={{...S.likeBtn,color:openComments===post.id?"#f5a623":"#ccc",borderColor:openComments===post.id?"#f5a623":"#2a2a2a"}} onClick={()=>{setOpenComments(openComments===post.id?null:post.id);setNewComment("");setTimeout(()=>commentInputRef.current?.focus(),200);}}>💬 {post.commentCount||0}</button>
                {post.userId!==authUser.uid&&<button style={{...S.likeBtn,fontSize:12}} onClick={()=>{const u=allUsers.find(u=>u.id===post.userId);if(u){setChallengeTarget(u);setShowChallengeModal(true);}}}>🎯</button>}
              </div>
              {openComments===post.id&&(
                <div style={{marginTop:12,borderTop:"1px solid #242424",paddingTop:12}}>
                  {(comments[post.id]||[]).map(c=>(<div key={c.id} style={{display:"flex",gap:8,marginBottom:10}}>
                    <span style={{fontSize:20,flexShrink:0}}>{c.userEmoji}</span>
                    <div style={{background:"#1e1e1e",borderRadius:"4px 12px 12px 12px",padding:"8px 12px",flex:1}}>
                      <div style={{fontWeight:700,fontSize:12,color:"#f5a623",marginBottom:3}}>{c.userName} <span style={{color:"#555",fontWeight:400}}>· {timeAgo(c.createdAt,L)}</span></div>
                      {c.text&&<div style={{fontSize:14,color:"#ddd",lineHeight:1.5}}>{c.text}</div>}
                      {c.imageUrl&&<img src={c.imageUrl} alt="" style={{width:"100%",maxHeight:200,objectFit:"cover",borderRadius:8,marginTop:6,cursor:"pointer"}} onClick={()=>setLightboxImg(c.imageUrl)}/>}
                    </div>
                  </div>))}
                  {(comments[post.id]||[]).length===0&&<div style={{color:"#555",fontSize:13,fontStyle:"italic",marginBottom:10}}>{L.firstComment}</div>}
                  {/* Comment image preview */}
                  {commentImagePreview&&openComments===post.id&&(
                    <div style={{position:"relative",marginBottom:8,marginLeft:30}}>
                      <img src={commentImagePreview} alt="" style={{width:"100%",maxHeight:150,objectFit:"cover",borderRadius:10}}/>
                      <button onClick={()=>{setCommentImage(null);setCommentImagePreview(null);if(commentFileInputRef.current)commentFileInputRef.current.value="";}} style={{position:"absolute",top:6,right:6,background:"rgba(0,0,0,0.7)",border:"none",color:"#fff",width:26,height:26,borderRadius:"50%",cursor:"pointer",fontSize:13}}>✕</button>
                    </div>
                  )}
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{fontSize:22,flexShrink:0}}>{profile?.emoji}</span>
                    <input ref={commentInputRef} style={{...S.input,flex:1,padding:"8px 12px",fontSize:14}} placeholder={L.addComment} value={newComment} onChange={e=>setNewComment(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submitComment(post.id);}}}/>
                    <button style={{...S.drinkBtn,color:"#f5a623",borderColor:"#f5a623",fontSize:16,padding:"6px 8px"}} onClick={()=>commentFileInputRef.current?.click()}>📸</button>
                    <input ref={commentFileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024){showToast(L.photoTooBig);return;}setCommentImage(file);setCommentImagePreview(URL.createObjectURL(file));}}/>
                    <button style={{...S.postBtn,padding:"8px 12px",fontSize:16,opacity:uploadingComment?0.6:1}} onClick={()=>submitComment(post.id)} disabled={uploadingComment}>{uploadingComment?"⏳":"→"}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {posts.filter(p=>!filterSector||p.sector===filterSector).length===0&&(
            <div style={S.emptyState}>
              {filterSector?(()=>{const s=SECTORS.find(x=>x.id===filterSector);return<>{s?.emoji} Nicio postare din {s?.label} încă.<br/>Fii primul din sector!</>;})():L.noPostsYet}
            </div>
          )}
        </div>)}

        {/* MAP */}
        {tab==="map"&&(<div>
          {!geo&&(<div style={{background:"#171717",border:"1px solid #242424",borderRadius:14,padding:16,marginBottom:12,textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:8}}>🗺️</div>
            <div style={{color:"#e8e0d0",fontWeight:700,marginBottom:6}}>Activează locația</div>
            <button style={S.geoBtn} onClick={requestGeo}>📍 Activează Locația</button>
            {geoError&&<div style={{color:"#e87070",fontSize:13,marginTop:8}}>{geoError}</div>}
          </div>)}
          <LiveMap allUsers={allUsers} currentUser={authUser} geo={geo} onUserClick={(u)=>setViewProfile(u)}/>
        </div>)}

        {/* NEARBY */}
        {tab==="nearby"&&(<div>
          <div style={{marginBottom:16,display:"flex",flexDirection:"column",gap:10}}>
            {geo?<div style={{color:"#4caf82",fontSize:14,fontWeight:600}}>📍 Locație activă</div>:<button style={S.geoBtn} onClick={requestGeo}>📍 Activează Locația</button>}
            {geoError&&<div style={{color:"#e87070",fontSize:13}}>{geoError}</div>}
            <div style={{display:"flex",alignItems:"center",gap:12}}><span style={{color:"#888",fontSize:13,whiteSpace:"nowrap",minWidth:90}}>Raza: {radius} km</span><input type="range" min={1} max={50} value={radius} onChange={e=>setRadius(+e.target.value)} style={{flex:1,accentColor:"#f5a623"}}/></div>
          </div>
          {!geo&&<div style={S.emptyState}>🗺️ Activează locația ca să vezi<br/>cine bea lângă tine.</div>}
          {geo&&nearbyUsers.length===0&&<div style={S.emptyState}>🌵 Niciun bețiv în {radius}km.</div>}
          {nearbyUsers.map(u=>(<div key={u.id} style={S.nearbyCard}>
            <span style={{fontSize:32,width:44,textAlign:"center"}}>{u.emoji}</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:15}}>{u.name}</div>
              <div style={{color:"#888",fontSize:12}}>📍 {distKm(geo.lat,geo.lon,u.lat,u.lon).toFixed(1)} km · {u.drink}</div>
              {u.checkinName&&<div style={{color:"#f5a623",fontSize:12}}>🍺 {u.checkinName}</div>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <button style={S.btnSmall} onClick={()=>setViewProfile(u)}>Profil</button>
              <button style={{...S.btnSmall,background:"#1a3a2a",color:"#4caf82",border:"1px solid #4caf82"}} onClick={()=>openChat(u)}>💬</button>
              <button style={{...S.btnSmall,background:"#2a1a00",color:"#f5a623",border:"1px solid #f5a623"}} onClick={()=>{setChallengeTarget(u);setShowChallengeModal(true);}}>🎯</button>
            </div>
          </div>))}
        </div>)}

        {/* FUN TAB - Challenges + Spin */}
        {tab==="fun"&&(<div>
          {/* Sub-tabs */}
          <div style={{display:"flex",background:"#1a1a1a",borderRadius:12,padding:4,gap:4,marginBottom:16}}>
            <button style={{flex:1,background:funTab==="challenges"?"#f5a623":"none",color:funTab==="challenges"?"#111":"#888",border:"none",borderRadius:8,padding:"10px",cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:700,fontSize:13,position:"relative"}} onClick={()=>setFunTab("challenges")}>
              🎯 Provocări
              {pendingChallenges>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#e87070",color:"#fff",borderRadius:"50%",width:18,height:18,fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{pendingChallenges}</span>}
            </button>
            <button style={{flex:1,background:funTab==="spin"?"#f5a623":"none",color:funTab==="spin"?"#111":"#888",border:"none",borderRadius:8,padding:"10px",cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:700,fontSize:13}} onClick={()=>setFunTab("spin")}>🍾 Spin</button>
            <button style={{flex:1,background:funTab==="top"?"#f5a623":"none",color:funTab==="top"?"#111":"#888",border:"none",borderRadius:8,padding:"10px",cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:700,fontSize:13}} onClick={()=>setFunTab("top")}>🏆 Top</button>
          </div>

          {/* CHALLENGES */}
          {funTab==="challenges"&&(<div>
            <button style={{...S.btnPrimary,marginBottom:16}} onClick={()=>setShowChallengeModal(true)}>{L.sendChallenge}</button>

            {myChallenges.length===0&&<div style={S.emptyState}>🎯 Nicio provocare încă.<br/>Provoacă un prieten!</div>}

            {myChallenges.map(c=>{
              const isToMe=c.toId===authUser.uid;
              const isFromMe=c.fromId===authUser.uid;
              return(
                <div key={c.id} style={{...S.postCard,borderColor:c.status==="pending"&&isToMe?"#f5a623":c.status==="completed"?"#4caf82":c.status==="declined"?"#e87070":"#242424"}}>
                  <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
                    <span style={{fontSize:28}}>{isToMe?c.fromEmoji:c.toEmoji}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:14,color:"#f5a623"}}>
                        {isFromMe?`Tu → ${c.toName}`:`${c.fromName} → Tu`}
                      </div>
                      <div style={{color:"#666",fontSize:12}}>{timeAgo(c.createdAt,L)}</div>
                    </div>
                    <div style={{padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:c.status==="pending"?"#2a2000":c.status==="accepted"?"#1a3a2a":c.status==="completed"?"#1a3a2a":"#3a1a1a",color:c.status==="pending"?"#f5a623":c.status==="accepted"?"#4caf82":c.status==="completed"?"#4caf82":"#e87070"}}>
                      {c.status==="pending"?"⏳ Așteptare":c.status==="accepted"?"✅ Acceptat":c.status==="completed"?"🏆 Completat":"❌ Refuzat"}
                    </div>
                  </div>
                  <div style={{fontSize:15,color:"#e8e0d0",marginBottom:12,padding:"10px 12px",background:"#1a1a1a",borderRadius:10}}>
                    {c.text}
                  </div>
                  {c.status==="pending"&&isToMe&&(
                    <div style={{display:"flex",gap:8}}>
                      <button style={{flex:1,background:"linear-gradient(135deg,#4caf82,#2d8a5e)",border:"none",borderRadius:10,padding:"10px",color:"#fff",cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:700}} onClick={()=>respondChallenge(c.id,true)}>{L.accept}</button>
                      <button style={{flex:1,background:"#2a2a2a",border:"1px solid #e87070",borderRadius:10,padding:"10px",color:"#e87070",cursor:"pointer",fontFamily:"Georgia,serif"}} onClick={()=>respondChallenge(c.id,false)}>{L.refuse}</button>
                    </div>
                  )}
                  {c.status==="accepted"&&isToMe&&(
                    <button style={{...S.btnPrimary,background:"linear-gradient(135deg,#4caf82,#2d8a5e)"}} onClick={()=>completeChallenge(c.id)}>🏆 Am completat! (+5 puncte)</button>
                  )}
                </div>
              );
            })}
          </div>)}

          {/* SPIN THE BOTTLE */}
          {funTab==="spin"&&(
            <SpinBottle allUsers={allUsers} currentUser={authUser} profile={profile} L={L} onSpun={(winner)=>{showToast(`🍾 Sticla l-a ales pe ${winner.name}!`);}}/>
          )}

          {/* TOP / LEADERBOARD */}
          {funTab==="top"&&(<div>
            {myStats&&(<div style={{background:"linear-gradient(135deg,#1a1200,#2a2000)",border:"1px solid #f5a623",borderRadius:16,padding:16,marginBottom:20}}>
              <div style={{color:"#f5a623",fontSize:12,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>{L.myStats}</div>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                <div style={{fontSize:40}}>{myStats.emoji}</div>
                <div><div style={{fontWeight:800,fontSize:18,color:"#f5a623"}}>{myStats.name}</div><div style={{color:"#888",fontSize:13}}>Locul #{myRank} în clasament</div></div>
                <div style={{marginLeft:"auto",textAlign:"center"}}><div style={{fontSize:28,fontWeight:900,color:"#f5a623"}}>{myStats.score}</div><div style={{color:"#888",fontSize:11}}>puncte</div></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
                {[{icon:"🍻",val:myStats.totalLikes,label:"Cheers"},{icon:"📝",val:myStats.totalPosts,label:"Postări"},{icon:"💬",val:myStats.totalComments,label:"Comentarii"},{icon:"🎯",val:challenges.filter(c=>c.toId===authUser.uid&&c.status==="completed").length,label:"Provocări"}].map(s=>(<div key={s.label} style={{background:"rgba(0,0,0,0.3)",borderRadius:10,padding:"8px 4px",textAlign:"center"}}><div style={{fontSize:18}}>{s.icon}</div><div style={{fontWeight:800,fontSize:16,color:"#f5a623"}}>{s.val}</div><div style={{color:"#888",fontSize:10}}>{s.label}</div></div>))}
              </div>
              <div style={{borderTop:"1px solid #333",paddingTop:12}}>
                <div style={{color:"#888",fontSize:12,marginBottom:8}}>Badge-urile tale:</div>
                {myStats.badges.length===0&&<div style={{color:"#555",fontSize:13,fontStyle:"italic"}}>Încă niciun badge. Fii mai activ! 🍺</div>}
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>{myStats.badges.map(bid=>{const b=BADGE_DEFS.find(x=>x.id===bid);if(!b)return null;return(<button key={bid} style={{background:"#1e1e1e",border:"1px solid #333",borderRadius:20,padding:"6px 12px",display:"flex",alignItems:"center",gap:6,cursor:"pointer",color:"#e8e0d0",fontSize:13}} onClick={()=>setBadgeTooltip(b)}><span>{b.icon}</span><span>{b.name}</span></button>);})}</div>
              </div>
            </div>)}
            <div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>{L.leaderboard}</div>
            {leaderboard.map((u,i)=>(<div key={u.id} style={{...S.postCard,borderColor:i===0?"#f5a623":i===1?"#888":i===2?"#cd7f32":"#242424",cursor:"pointer"}} onClick={()=>setViewProfile(u)}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{fontSize:24,width:32,textAlign:"center",fontWeight:900,color:i===0?"#f5a623":i===1?"#aaa":i===2?"#cd7f32":"#666"}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}</div>
                <span style={{fontSize:28}}>{u.emoji}</span>
                <div style={{flex:1}}><div style={{fontWeight:700,fontSize:15,color:u.id===authUser.uid?"#f5a623":"#e8e0d0"}}>{u.name} {u.id===authUser.uid&&"(tu)"}</div><div style={{display:"flex",gap:8,marginTop:4}}>{u.badges.slice(0,3).map(bid=>{const b=BADGE_DEFS.find(x=>x.id===bid);return b?<span key={bid}>{b.icon}</span>:null;})}</div></div>
                <div style={{textAlign:"right"}}><div style={{fontWeight:800,fontSize:18,color:"#f5a623"}}>{u.score}</div><div style={{color:"#888",fontSize:11}}>🍻{u.totalLikes} 🎯{challenges.filter(c=>(c.fromId===u.id||c.toId===u.id)&&c.status==="completed").length}</div></div>
              </div>
            </div>))}
            <div style={{marginTop:24,borderTop:"1px solid #1e1e1e",paddingTop:16}}>
              <div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>{L.allBadges}</div>
              {BADGE_DEFS.map(b=>(<div key={b.id} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}><span style={{fontSize:24,width:30,textAlign:"center"}}>{b.icon}</span><div><div style={{fontWeight:700,fontSize:14}}>{b.name}</div><div style={{color:"#888",fontSize:12}}>{b.desc}</div></div></div>))}
            </div>
          </div>)}
        </div>)}

        {/* LEADERBOARD */}
        {tab==="leaderboard"&&(<div>
          {myStats&&(<div style={{background:"linear-gradient(135deg,#1a1200,#2a2000)",border:"1px solid #f5a623",borderRadius:16,padding:16,marginBottom:20}}>
            <div style={{color:"#f5a623",fontSize:12,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Statisticile Tale</div>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{fontSize:40}}>{myStats.emoji}</div>
              <div><div style={{fontWeight:800,fontSize:18,color:"#f5a623"}}>{myStats.name}</div><div style={{color:"#888",fontSize:13}}>Locul #{myRank} în clasament</div></div>
              <div style={{marginLeft:"auto",textAlign:"center"}}><div style={{fontSize:28,fontWeight:900,color:"#f5a623"}}>{myStats.score}</div><div style={{color:"#888",fontSize:11}}>puncte</div></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
              {[{icon:"🍻",val:myStats.totalLikes,label:"Cheers"},{icon:"📝",val:myStats.totalPosts,label:"Postări"},{icon:"💬",val:myStats.totalComments,label:"Comentarii"},{icon:"🎯",val:challenges.filter(c=>c.toId===authUser.uid&&c.status==="completed").length,label:"Provocări"}].map(s=>(<div key={s.label} style={{background:"rgba(0,0,0,0.3)",borderRadius:10,padding:"8px 4px",textAlign:"center"}}><div style={{fontSize:18}}>{s.icon}</div><div style={{fontWeight:800,fontSize:16,color:"#f5a623"}}>{s.val}</div><div style={{color:"#888",fontSize:10}}>{s.label}</div></div>))}
            </div>
            <div style={{borderTop:"1px solid #333",paddingTop:12}}>
              <div style={{color:"#888",fontSize:12,marginBottom:8}}>Badge-urile tale:</div>
              {myStats.badges.length===0&&<div style={{color:"#555",fontSize:13,fontStyle:"italic"}}>Încă niciun badge. Fii mai activ! 🍺</div>}
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>{myStats.badges.map(bid=>{const b=BADGE_DEFS.find(x=>x.id===bid);if(!b)return null;return(<button key={bid} style={{background:"#1e1e1e",border:"1px solid #333",borderRadius:20,padding:"6px 12px",display:"flex",alignItems:"center",gap:6,cursor:"pointer",color:"#e8e0d0",fontSize:13}} onClick={()=>setBadgeTooltip(b)}><span>{b.icon}</span><span>{b.name}</span></button>);})}</div>
            </div>
          </div>)}
          <div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>{L.leaderboard}</div>
          {leaderboard.map((u,i)=>(<div key={u.id} style={{...S.postCard,borderColor:i===0?"#f5a623":i===1?"#888":i===2?"#cd7f32":"#242424",cursor:"pointer"}} onClick={()=>setViewProfile(u)}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{fontSize:24,width:32,textAlign:"center",fontWeight:900,color:i===0?"#f5a623":i===1?"#aaa":i===2?"#cd7f32":"#666"}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}</div>
              <span style={{fontSize:28}}>{u.emoji}</span>
              <div style={{flex:1}}><div style={{fontWeight:700,fontSize:15,color:u.id===authUser.uid?"#f5a623":"#e8e0d0"}}>{u.name} {u.id===authUser.uid&&"(tu)"}</div><div style={{display:"flex",gap:8,marginTop:4}}>{u.badges.slice(0,3).map(bid=>{const b=BADGE_DEFS.find(x=>x.id===bid);return b?<span key={bid}>{b.icon}</span>:null;})}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontWeight:800,fontSize:18,color:"#f5a623"}}>{u.score}</div><div style={{color:"#888",fontSize:11}}>🍻{u.totalLikes} 🎯{challenges.filter(c=>(c.fromId===u.id||c.toId===u.id)&&c.status==="completed").length}</div></div>
            </div>
          </div>))}
        </div>)}

        {/* MESSAGES */}
        {tab==="messages"&&!chatWith&&(<div>
          <div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>{L.conversations}</div>
          {conversations.map(conv=>{const otherId=conv.participants.find(p=>p!==authUser.uid);const otherName=conv.participantNames?.[otherId]||"Utilizator";const otherEmoji=conv.participantEmojis?.[otherId]||"🍺";const isUnread=conv.lastSenderId!==authUser.uid&&!(conv.readBy||[]).includes(authUser.uid);const otherUser=allUsers.find(u=>u.id===otherId);const st=getStatus(otherUser,L);return(<div key={conv.id} style={{...S.postCard,cursor:"pointer",borderColor:isUnread?"#f5a623":"#242424"}} onClick={()=>otherUser&&setChatWith(otherUser)}><div style={{display:"flex",gap:12,alignItems:"center"}}><div style={{position:"relative",flexShrink:0}}><span style={{fontSize:32}}>{otherEmoji}</span>{st&&<span style={{position:"absolute",bottom:0,right:0,width:10,height:10,borderRadius:"50%",background:st.dot,border:"2px solid #171717"}}/>}</div><div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,color:isUnread?"#f5a623":"#e8e0d0"}}>{otherName}</div><div style={{color:"#888",fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{conv.lastMessage}</div></div><div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}><span style={{color:"#555",fontSize:11}}>{timeAgo(conv.lastMessageAt,L)}</span>{isUnread&&<span style={{background:"#f5a623",color:"#111",borderRadius:10,padding:"2px 7px",fontSize:11,fontWeight:700}}>{L.newLabel}</span>}</div></div></div>);})}
          <div style={{marginTop:20}}>
            <input style={{...S.input,marginBottom:12}} placeholder={L.searchUsers} value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/>
            <div style={{color:"#888",fontSize:13,marginBottom:10}}>{searchQuery?`Rezultate pentru "${searchQuery}":`:"Toți utilizatorii:"}</div>
            {filteredUsers.map(u=>{const st=getStatus(u,L);return(<div key={u.id} style={{...S.nearbyCard,cursor:"pointer"}} onClick={()=>setChatWith(u)}>
              <div style={{position:"relative",flexShrink:0}}>
                <span style={{fontSize:28}}>{u.emoji}</span>
                {st&&<span style={{position:"absolute",bottom:0,right:0,width:10,height:10,borderRadius:"50%",background:st.dot,border:"2px solid #171717"}}/>}
              </div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14}}>{u.name}</div>
                <div style={{color:"#888",fontSize:12,display:"flex",alignItems:"center",gap:5}}>
                  {st?<><span style={{width:6,height:6,borderRadius:"50%",background:st.dot,display:"inline-block",flexShrink:0}}/><span style={{color:st.dot==="#4caf82"?"#4caf82":st.dot==="#f5a623"?"#f5a623":"#888"}}>{st.label}</span></>:<span>{u.drink}</span>}
                </div>
              </div>
              <button style={{...S.btnSmall,background:"#1a3a2a",color:"#4caf82",border:"1px solid #4caf82"}}>{L.chatBtn}</button>
            </div>);})}
          </div>
        </div>)}

        {tab==="messages"&&chatWith&&(<div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 140px)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingBottom:12,borderBottom:"1px solid #1e1e1e"}}>
            <button style={{background:"none",border:"none",color:"#f5a623",fontSize:22,cursor:"pointer"}} onClick={()=>setChatWith(null)}>←</button>
            <span style={{fontSize:28}}>{chatWith.emoji}</span>
            <div style={{flex:1}}><div style={{fontWeight:700,color:"#f5a623"}}>{chatWith.name}</div><div style={{color:"#888",fontSize:12,display:"flex",alignItems:"center",gap:5}}>{(()=>{const st=getStatus(chatWith,L);return st?<><span style={{width:7,height:7,borderRadius:"50%",background:st.dot,display:"inline-block"}}/><span>{st.label}</span></>:<span>{chatWith.drink}</span>;})()}</div></div>
          </div>
          <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:8,paddingBottom:8}}>
            {messages.length===0&&<div style={{textAlign:"center",color:"#555",marginTop:40,fontStyle:"italic"}}>{L.startConversation}</div>}
            {messages.map(msg=>{const isMe=msg.senderId===authUser.uid;return(<div key={msg.id} style={{display:"flex",justifyContent:isMe?"flex-end":"flex-start"}}><div style={{maxWidth:"75%",background:isMe?"linear-gradient(135deg,#f5a623,#e8890a)":"#1e1e1e",color:isMe?"#111":"#e8e0d0",borderRadius:isMe?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"10px 14px",fontSize:14,lineHeight:1.5}}><div>{msg.text}</div><div style={{fontSize:10,opacity:0.6,marginTop:4,textAlign:"right"}}>{timeAgo(msg.createdAt,L)}</div></div></div>);})}
            <div ref={messagesEndRef}/>
          </div>
          <div style={{display:"flex",gap:8,paddingTop:8,borderTop:"1px solid #1e1e1e"}}>
            <input style={{...S.input,flex:1,padding:"10px 14px"}} placeholder={L.typeMessage} value={newMsg} onChange={e=>setNewMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMessage()}/>
            <button style={{...S.postBtn,padding:"10px 16px",fontSize:18}} onClick={sendMessage}>→</button>
          </div>
        </div>)}

        {tab==="profile"&&profile&&(<div>
          <ProfileView user={{...profile,id:authUser.uid}} posts={posts} allUsers={allUsers} isOwn={true} onSignOut={handleSignOut} onEdit={openEditProfile} onLightbox={setLightboxImg} onBadge={setBadgeTooltip} onChallenge={(u)=>{setChallengeTarget(u);setShowChallengeModal(true);}} styles={S} timeAgo={timeAgo} getTitle={getTitle} computeBadges={computeBadges} BADGE_DEFS={BADGE_DEFS} L={L}/>
          {/* Notifications Settings */}
          <div style={{background:"#171717",border:"1px solid #242424",borderRadius:14,padding:16,marginTop:8}}>
            <div style={{fontWeight:700,fontSize:15,color:"#f5a623",marginBottom:12}}>{L.notifsSection}</div>
            {notifPermission==="granted"?(
              <div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:"#4caf82",flexShrink:0}}/>
                  <div style={{color:"#4caf82",fontSize:14,fontWeight:600}}>{L.notifsActive}</div>
                </div>
                <div style={{color:"#888",fontSize:12,marginBottom:12,lineHeight:1.6}}>
                  Primești notificări pentru mesaje noi, provocări și cheers.
                </div>
                <button style={{...S.btnSmall,width:"100%",padding:"10px",color:"#e87070",border:"1px solid #e87070",textAlign:"center"}} onClick={disableNotifications}>
                  Dezactivează Notificările
                </button>
              </div>
            ) : notifPermission==="denied" ? (
              <div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:"#e87070",flexShrink:0}}/>
                  <div style={{color:"#e87070",fontSize:14,fontWeight:600}}>{L.notifsBlocked}</div>
                </div>
                <div style={{color:"#888",fontSize:12,lineHeight:1.6}}>
                  Notificările sunt blocate în browser. Pentru a le activa, mergi în setările browserului și permite notificările pentru acest site.
                </div>
              </div>
            ) : (
              <div>
                <div style={{color:"#888",fontSize:13,marginBottom:14,lineHeight:1.6}}>
                  Activează notificările ca să fii anunțat când primești mesaje, provocări sau cheers! 🍻
                </div>
                <button style={{...S.btnPrimary,display:"flex",alignItems:"center",justifyContent:"center",gap:8}} onClick={enableNotifications}>
                  🔔 Activează Notificările
                </button>
              </div>
            )}
          </div>
        </div>)}
      </div>

      {/* NAV */}
      <div style={S.nav}>
        {[
          {key:"feed",icon:"🏠",label:L.feed},
          {key:"map",icon:"🗺️",label:L.map},
          {key:"fun",icon:"🎯",label:L.fun,badge:pendingChallenges},
          {key:"messages",icon:"💬",label:L.messages,badge:unreadCount},
          {key:"profile",icon:profile?.emoji,label:L.profile},
        ].map(t=>(
          <button key={t.key} style={{...S.navBtn,...(tab===t.key?S.navBtnActive:{})}} onClick={()=>{setTab(t.key);if(t.key!=="messages")setChatWith(null);setOpenComments(null);}}>
            <div style={{position:"relative",display:"inline-block"}}>
              <span style={{fontSize:20}}>{t.icon}</span>
              {t.badge>0&&<span style={{position:"absolute",top:-4,right:-6,background:"#e87070",color:"#fff",borderRadius:"50%",width:16,height:16,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{t.badge}</span>}
            </div>
            <span style={{fontSize:9,letterSpacing:0.5}}>{t.label}</span>
          </button>
        ))}
      </div>

      {viewProfile&&(<div style={S.modal} onClick={()=>setViewProfile(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><button style={S.modalClose} onClick={()=>setViewProfile(null)}>✕</button><ProfileView user={viewProfile} posts={posts} allUsers={allUsers} isOwn={viewProfile.id===authUser.uid} onReview={u=>{setViewProfile(null);setReviewTarget(u);setReviewText("");setReviewRating(5);}} onChat={u=>openChat(u)} onEdit={viewProfile.id===authUser.uid?openEditProfile:null} onChallenge={(u)=>{setViewProfile(null);setChallengeTarget(u);setShowChallengeModal(true);}} onLightbox={setLightboxImg} onBadge={setBadgeTooltip} styles={S} timeAgo={timeAgo} getTitle={getTitle} computeBadges={computeBadges} BADGE_DEFS={BADGE_DEFS} L={L}/></div></div>)}

      {reviewTarget&&(<div style={S.modal} onClick={()=>setReviewTarget(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><button style={S.modalClose} onClick={()=>setReviewTarget(null)}>✕</button><div style={{fontSize:18,fontWeight:700,color:"#f5a623",marginBottom:16,textAlign:"center"}}>Recenzie pentru {reviewTarget.name}</div><div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:8}}>{[1,2,3,4,5].map(s=><button key={s} style={{background:"none",border:"none",cursor:"pointer",padding:2}} onMouseEnter={()=>setHoverRating(s)} onMouseLeave={()=>setHoverRating(0)} onClick={()=>setReviewRating(s)}><span style={{fontSize:28,color:s<=(hoverRating||reviewRating)?"#f5a623":"#444"}}>★</span></button>)}</div><div style={{textAlign:"center",color:"#f5a623",marginBottom:12,fontSize:14}}>{["",L.star1,L.star2,L.star3,L.star4,L.star5][hoverRating||reviewRating]}</div><textarea style={{...S.input,height:90,resize:"none"}} placeholder={L.reviewPlaceholder} value={reviewText} onChange={e=>setReviewText(e.target.value)}/><button style={S.btnPrimary} onClick={submitReview}>{L.sendReview}</button></div></div>)}
    </div>
  );
}

function ProfileView({user,posts,allUsers,isOwn,onSignOut,onEdit,onReview,onChat,onChallenge,onLightbox,onBadge,styles:S,timeAgo,getTitle,computeBadges,BADGE_DEFS,L}){
  const l=L||LANGS.ro;
  const userPosts=posts.filter(p=>p.userId===user.id);
  const totalLikes=userPosts.reduce((s,p)=>s+(p.likes||[]).length,0);
  const badges=computeBadges({...user,id:user.id||user.uid},posts,allUsers||[]);
  const st=getStatus(user,l);
  return(<div style={{paddingBottom:20}}>
    <div style={{textAlign:"center",paddingBottom:20,borderBottom:"1px solid #1e1e1e",marginBottom:16}}>
      <div style={{position:"relative",display:"inline-block",marginBottom:8}}>
        <div style={{fontSize:64}}>{user.emoji}</div>
        {st&&<span style={{position:"absolute",bottom:4,right:4,width:16,height:16,borderRadius:"50%",background:st.dot,border:"3px solid #141414"}}/>}
      </div>
      <div style={{fontSize:22,fontWeight:800,color:"#f5a623"}}>{user.name}</div>
      {st&&<div style={{display:"inline-flex",alignItems:"center",gap:5,marginTop:4,background:"#1a1a1a",borderRadius:20,padding:"4px 10px"}}><span style={{width:7,height:7,borderRadius:"50%",background:st.dot,display:"inline-block"}}/><span style={{color:"#aaa",fontSize:12}}>{st.label}</span></div>}
      <div style={{color:"#888",fontSize:13,fontStyle:"italic",marginTop:4}}>{getTitle(user.avgRating)}</div>
      <div style={{color:"#bbb",fontSize:14,marginTop:6}}>🥤 {user.drink}</div>
      <div style={{color:"#aaa",fontSize:14,marginTop:10,fontStyle:"italic",lineHeight:1.6}}>{user.bio}</div>
      <div style={{marginTop:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><span style={{color:"#f5a623",fontSize:20}}>{"★".repeat(Math.round(user.avgRating||0))}</span><span style={{color:"#888",fontSize:12}}>{user.avgRating||0} ({user.totalRatings||0} recenzii)</span></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:14}}>{[{icon:"📝",val:userPosts.length,label:"Postări"},{icon:"🍻",val:totalLikes,label:"Cheers"},{icon:"⭐",val:user.totalRatings||0,label:"Recenzii"},{icon:"🎯",val:user.challengesAccepted||0,label:"Provocări"}].map(s=>(<div key={s.label} style={{background:"#1a1a1a",borderRadius:10,padding:"8px 4px",textAlign:"center"}}><div style={{fontSize:18}}>{s.icon}</div><div style={{fontWeight:800,fontSize:16,color:"#f5a623"}}>{s.val}</div><div style={{color:"#888",fontSize:11}}>{s.label}</div></div>))}</div>
      {badges.length>0&&(<div style={{marginTop:14}}><div style={{color:"#888",fontSize:12,marginBottom:8}}>Badge-uri:</div><div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center"}}>{badges.map(bid=>{const b=BADGE_DEFS.find(x=>x.id===bid);if(!b)return null;return(<button key={bid} style={{background:"#1e1e1e",border:"1px solid #333",borderRadius:20,padding:"5px 10px",display:"flex",alignItems:"center",gap:5,cursor:"pointer",color:"#e8e0d0",fontSize:12}} onClick={()=>onBadge&&onBadge(b)}><span>{b.icon}</span><span>{b.name}</span></button>);})}</div></div>)}
      {isOwn&&onEdit&&<button style={{...S.btnPrimary,marginTop:12,background:"linear-gradient(135deg,#2a4a8a,#1a3a6a)"}} onClick={onEdit}>✏️ Editează Profilul</button>}
      {!isOwn&&<div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
        {onReview&&<button style={{...S.btnPrimary,flex:1}} onClick={()=>onReview(user)}>{L.reviewBtn}</button>}
        {onChat&&<button style={{...S.btnPrimary,flex:1,background:"linear-gradient(135deg,#4caf82,#2d8a5e)"}} onClick={()=>onChat(user)}>{L.messageBtn}</button>}
        {onChallenge&&<button style={{...S.btnPrimary,flex:1,background:"linear-gradient(135deg,#a83200,#7a2000)"}} onClick={()=>onChallenge(user)}>{L.challengeBtn}</button>}
      </div>}
      {isOwn&&onSignOut&&<button style={{...S.btnSmall,marginTop:10,width:"100%",padding:"10px",color:"#e87070",border:"1px solid #e87070"}} onClick={onSignOut}>{L.signOut}</button>}
    </div>
    {(user.ratings||[]).length>0&&<div style={{marginBottom:16}}><div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>{l.reviews}</div>{[...(user.ratings||[])].reverse().map((r,i)=>(<div key={i} style={{background:"#1a1a1a",borderRadius:10,padding:12,marginBottom:8}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><span style={{color:"#f5a623"}}>{"★".repeat(r.rating)}</span><span style={{fontWeight:700,fontSize:13,color:"#ccc"}}>{r.fromName}</span><span style={{color:"#555",fontSize:12,marginLeft:"auto"}}>{timeAgo({seconds:r.time/1000},l)}</span></div><div style={{color:"#bbb",fontSize:14,lineHeight:1.5}}>{r.text}</div></div>))}</div>}
    {userPosts.length>0&&<div><div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>{l.postsLabel}</div>{userPosts.map(p=>(<div key={p.id} style={{background:"#1a1a1a",borderRadius:10,padding:12,marginBottom:8}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><span>{p.drink}</span><span style={{color:"#555",fontSize:12,marginLeft:"auto"}}>{timeAgo(p.createdAt,l)}</span></div>{p.text&&<div style={{color:"#bbb",fontSize:14,lineHeight:1.5,marginBottom:p.imageUrl?8:0}}>{p.text}</div>}{p.imageUrl&&<img src={p.imageUrl} alt="" style={{width:"100%",maxHeight:200,objectFit:"cover",borderRadius:8,cursor:"pointer"}} onClick={()=>onLightbox&&onLightbox(p.imageUrl)}/>}<div style={{color:"#888",fontSize:12,marginTop:6}}>🍻 {(p.likes||[]).length} {l.cheersLabel} · 💬 {p.commentCount||0}</div></div>))}</div>}
  </div>);
}

const S={
  splash:{minHeight:"100vh",minHeight:"100dvh",background:"#0a0a0a",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Georgia,serif",position:"relative",flexDirection:"column"},
  splashGlow:{position:"absolute",width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,rgba(245,166,35,0.25) 0%,transparent 70%)",top:"50%",left:"50%",transform:"translate(-50%,-50%)"},
  splashTitle:{fontSize:36,fontWeight:900,letterSpacing:8,color:"#f5a623",textAlign:"center"},
  splashLoader:{width:200,height:3,background:"#222",borderRadius:2,margin:"24px auto 0",overflow:"hidden"},
  splashBar:{height:"100%",background:"linear-gradient(90deg,#f5a623,#e8890a)",borderRadius:2,animation:"load 2s ease-in-out forwards"},
  root:{minHeight:"100vh",minHeight:"100dvh",background:"#0f0f0f",color:"#e8e0d0",fontFamily:"Georgia,serif",maxWidth:480,margin:"0 auto",position:"relative",WebkitTapHighlightColor:"transparent"},
  loginWrap:{padding:"40px 20px",display:"flex",flexDirection:"column",gap:16,minHeight:"100vh",minHeight:"100dvh"},
  authTabs:{display:"flex",background:"#1a1a1a",borderRadius:12,padding:4,gap:4},
  authTab:{flex:1,background:"none",border:"none",color:"#888",padding:"13px 10px",borderRadius:10,cursor:"pointer",fontFamily:"Georgia,serif",fontSize:16,WebkitAppearance:"none"},
  authTabActive:{background:"#f5a623",color:"#111",fontWeight:700},
  input:{width:"100%",boxSizing:"border-box",background:"#1a1a1a",border:"1px solid #333",borderRadius:12,padding:"14px 16px",color:"#e8e0d0",fontSize:16,fontFamily:"Georgia,serif",outline:"none",WebkitAppearance:"none",appearance:"none"},
  btnPrimary:{background:"linear-gradient(135deg,#f5a623,#e8890a)",color:"#111",border:"none",borderRadius:12,padding:"16px 20px",fontWeight:800,fontSize:17,cursor:"pointer",letterSpacing:0.5,width:"100%",fontFamily:"Georgia,serif",WebkitAppearance:"none",minHeight:52},
  setupHeader:{display:"flex",alignItems:"center",gap:12,marginBottom:12},
  backBtn:{background:"none",border:"none",color:"#f5a623",fontSize:24,cursor:"pointer",padding:"8px 12px",minWidth:44,minHeight:44,display:"flex",alignItems:"center",justifyContent:"center"},
  setupQ:{fontSize:22,fontWeight:700,marginBottom:10,color:"#f5a623",lineHeight:1.3},
  emojiGrid:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10},
  emojiBtn:{fontSize:32,background:"#1a1a1a",border:"2px solid #2a2a2a",borderRadius:14,padding:"14px",cursor:"pointer",minHeight:64,WebkitAppearance:"none"},
  emojiBtnActive:{border:"2px solid #f5a623",background:"#2a2000"},
  header:{position:"sticky",top:0,zIndex:50,background:"rgba(15,15,15,0.97)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",borderBottom:"1px solid #1e1e1e",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px"},
  avatarBtn:{background:"#1e1e1e",border:"1px solid #2a2a2a",borderRadius:"50%",width:42,height:42,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",minWidth:42},
  content:{padding:"12px 14px",paddingBottom:90},
  composer:{background:"#171717",border:"1px solid #242424",borderRadius:16,padding:14,marginBottom:14},
  composerInput:{flex:1,background:"none",border:"none",color:"#e8e0d0",fontSize:16,resize:"none",outline:"none",fontFamily:"Georgia,serif",width:"100%",lineHeight:1.5},
  drinkBtn:{background:"none",border:"1px solid #2a2a2a",borderRadius:8,padding:"6px 7px",fontSize:18,cursor:"pointer",minWidth:36,minHeight:36,display:"inline-flex",alignItems:"center",justifyContent:"center"},
  drinkBtnActive:{background:"#2a2000",border:"1px solid #f5a623"},
  postBtn:{background:"#f5a623",color:"#111",border:"none",borderRadius:10,padding:"10px 18px",fontWeight:800,cursor:"pointer",fontFamily:"Georgia,serif",fontSize:15,minHeight:42,minWidth:44},
  postCard:{background:"#171717",border:"1px solid #242424",borderRadius:16,padding:"14px 14px",marginBottom:12},
  postAvatar:{fontSize:24,background:"#1e1e1e",border:"1px solid #2a2a2a",borderRadius:"50%",width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,minWidth:44},
  likeBtn:{background:"#1e1e1e",border:"1px solid #2a2a2a",borderRadius:10,padding:"8px 14px",color:"#ccc",cursor:"pointer",fontSize:14,fontFamily:"Georgia,serif",minHeight:40},
  geoBtn:{background:"#1e1e1e",border:"1px solid #f5a623",color:"#f5a623",borderRadius:12,padding:"13px 18px",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:15,width:"100%",minHeight:48},
  emptyState:{textAlign:"center",color:"#666",fontSize:16,lineHeight:1.9,marginTop:60,fontStyle:"italic",padding:"0 20px"},
  nearbyCard:{background:"#171717",border:"1px solid #242424",borderRadius:16,padding:14,marginBottom:12,display:"flex",alignItems:"center",gap:12},
  btnSmall:{background:"#1e1e1e",border:"1px solid #2a2a2a",color:"#e8e0d0",borderRadius:10,padding:"9px 14px",cursor:"pointer",fontSize:13,fontFamily:"Georgia,serif",whiteSpace:"nowrap",minHeight:40,minWidth:44},
  nav:{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"rgba(10,10,10,0.98)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",borderTop:"1px solid #1e1e1e",display:"flex",zIndex:100,paddingBottom:"env(safe-area-inset-bottom)"},
  navBtn:{flex:1,background:"none",border:"none",color:"#555",cursor:"pointer",padding:"12px 0 10px",display:"flex",flexDirection:"column",alignItems:"center",gap:4,fontFamily:"Georgia,serif",minHeight:56,WebkitAppearance:"none"},
  navBtnActive:{color:"#f5a623"},
  modal:{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)"},
  modalBox:{background:"#141414",borderRadius:"22px 22px 0 0",width:"100%",maxWidth:480,maxHeight:"90vh",maxHeight:"90dvh",overflowY:"auto",padding:"20px 18px",paddingBottom:"calc(20px + env(safe-area-inset-bottom))",position:"relative",borderTop:"1px solid #2a2a2a"},
  modalClose:{position:"absolute",top:16,right:16,background:"#2a2a2a",border:"none",color:"#ccc",width:36,height:36,borderRadius:"50%",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"},
  toast:{position:"fixed",top:72,left:"50%",transform:"translateX(-50%)",background:"#f5a623",color:"#111",padding:"11px 22px",borderRadius:30,fontWeight:700,fontSize:14,zIndex:300,whiteSpace:"nowrap",boxShadow:"0 4px 20px rgba(245,166,35,0.5)",maxWidth:"90vw",overflow:"hidden",textOverflow:"ellipsis"},
};
