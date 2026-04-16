import { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
} from "firebase/auth";
import {
  doc, setDoc, getDoc, collection, addDoc, onSnapshot,
  query, orderBy, updateDoc, serverTimestamp, where
} from "firebase/firestore";

const DRINKS = ["🍺","🍻","🥃","🍷","🍸","🍹","🥂","🍾"];
const TITLES = ["Încă Sobru","Prima Bere","Al Doilea Rând","Vibe Check","Deja Fluent","Filozoful Barului","Regele Mesei","Legendă Vie"];
const IMGBB_KEY = "8a79556a7f61c84b45baf5005c507fe2";

const BADGE_DEFS = [
  { id:"veteran",    icon:"🍺", name:"Veteran",        desc:"Cont mai vechi de 7 zile" },
  { id:"popular",   icon:"🥇", name:"Regele Barului",  desc:"Cel mai multe cheers total" },
  { id:"onfire",    icon:"🔥", name:"On Fire",         desc:"5+ postări în ultimele 7 zile" },
  { id:"chatterbox",icon:"💬", name:"Gura Satului",    desc:"20+ comentarii scrise" },
  { id:"vip",       icon:"⭐", name:"VIP",             desc:"Rating mediu peste 4.5 stele" },
  { id:"explorer",  icon:"📍", name:"Explorer",        desc:"Locație activată" },
  { id:"critic",    icon:"🎭", name:"Critic de Bar",   desc:"A scris 5+ recenzii" },
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
  return badges;
}

function getTitle(r){if(!r||r<1)return TITLES[0];if(r<2)return TITLES[1];if(r<3)return TITLES[2];if(r<4)return TITLES[3];if(r<5)return TITLES[4];if(r<6)return TITLES[5];if(r<8)return TITLES[6];return TITLES[7];}
function distKm(lat1,lon1,lat2,lon2){const R=6371,dLat=((lat2-lat1)*Math.PI)/180,dLon=((lon2-lon1)*Math.PI)/180,a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function timeAgo(ts){if(!ts)return "";const diff=Date.now()-(ts.seconds?ts.seconds*1000:ts);if(diff<60000)return "acum";if(diff<3600000)return Math.floor(diff/60000)+" min";if(diff<86400000)return Math.floor(diff/3600000)+"h";return Math.floor(diff/86400000)+"z";}
function getChatId(a,b){return [a,b].sort().join("_");}
function setCookie(n,v,d=365){document.cookie=`${n}=${encodeURIComponent(v)};path=/;max-age=${d*86400};SameSite=Lax`;}
function getCookie(n){return decodeURIComponent(document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith(n+'='))?.split('=')[1]||'');}
function deleteCookie(n){document.cookie=`${n}=;path=/;max-age=0`;}
async function uploadToImgbb(file){const fd=new FormData();fd.append('image',file);const r=await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`,{method:'POST',body:fd});const d=await r.json();if(d.success)return d.data.url;throw new Error('Upload failed');}

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
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if (!window.L) {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => setLeafletLoaded(true);
      document.head.appendChild(script);
    } else {
      setLeafletLoaded(true);
    }
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
        className: '', iconSize: [size, size], iconAnchor: [size/2, size/2],
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
  const inputS = {width:"100%",boxSizing:"border-box",background:"#1a1a1a",border:"1px solid #333",borderRadius:10,padding:"10px 14px",color:"#e8e0d0",fontSize:15,fontFamily:"Georgia,serif",outline:"none"};

  return (
    <div>
      <div style={{background:"#171717",border:"1px solid #242424",borderRadius:14,padding:12,marginBottom:12}}>
        {myUser?.checkinName ? (
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:20}}>📍</span>
            <div style={{flex:1}}><div style={{color:"#f5a623",fontWeight:700,fontSize:14}}>Check-in: {myUser.checkinName}</div><div style={{color:"#888",fontSize:12}}>Ești vizibil pe hartă</div></div>
            <button style={{background:"#e87070",border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif"}} onClick={handleCheckout}>Check-out</button>
          </div>
        ) : showCheckin ? (
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input style={{...inputS,flex:1,padding:"8px 12px"}} placeholder="Numele barului..." value={checkinName} onChange={e=>setCheckinName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleCheckin()} autoFocus/>
            <button style={{background:"#f5a623",border:"none",borderRadius:8,padding:"8px 14px",color:"#111",fontWeight:700,cursor:"pointer",fontFamily:"Georgia,serif"}} onClick={handleCheckin}>✓</button>
            <button style={{background:"#2a2a2a",border:"none",borderRadius:8,padding:"8px 10px",color:"#888",cursor:"pointer"}} onClick={()=>setShowCheckin(false)}>✕</button>
          </div>
        ) : (
          <button style={{background:"none",border:"1px dashed #444",borderRadius:10,padding:"10px",width:"100%",color:"#888",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8}} onClick={()=>setShowCheckin(true)}>📍 Check-in la un bar</button>
        )}
      </div>
      {!leafletLoaded && <div style={{height:400,background:"#171717",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",color:"#888"}}>Se încarcă harta... 🗺️</div>}
      <div ref={mapRef} style={{height:420,borderRadius:14,overflow:"hidden",display:leafletLoaded?"block":"none"}}/>
      <div style={{display:"flex",gap:12,marginTop:10,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:6,color:"#888",fontSize:12}}><div style={{width:12,height:12,borderRadius:"50%",background:"#f5a623",border:"2px solid #fff"}}/> Tu</div>
        <div style={{display:"flex",alignItems:"center",gap:6,color:"#888",fontSize:12}}><div style={{width:12,height:12,borderRadius:"50%",background:"#2a2a2a",border:"2px solid #f5a623"}}/> Activ recent</div>
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
        {allUsers.filter(u=>u.lat&&u.lon).length===0&&<div style={{textAlign:"center",color:"#666",fontSize:14,fontStyle:"italic",marginTop:20}}>Nimeni nu are locația activată încă.</div>}
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
  const [lightboxImg,setLightboxImg]=useState(null);
  const [badgeTooltip,setBadgeTooltip]=useState(null);
  const [searchQuery,setSearchQuery]=useState("");
  const [globalSearch,setGlobalSearch]=useState("");
  const [showGlobalSearch,setShowGlobalSearch]=useState(false);
  const messagesEndRef=useRef(null);
  const commentInputRef=useRef(null);
  const fileInputRef=useRef(null);
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
    const update=()=>updateDoc(doc(db,"users",authUser.uid),{lastSeen:serverTimestamp()}).catch(()=>{});
    update();
    const interval=setInterval(update,5*60*1000);
    return()=>clearInterval(interval);
  },[authUser,screen]);

  useEffect(()=>{
    if(showGlobalSearch)setTimeout(()=>searchRef.current?.focus(),100);
  },[showGlobalSearch]);

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(null),2800);}

  async function handleAuth(){
    setAuthError("");
    try{
      let user;
      if(authMode==="register"){const cred=await createUserWithEmailAndPassword(auth,email,password);user=cred.user;}
      else{const cred=await signInWithEmailAndPassword(auth,email,password);user=cred.user;}
      setCookie('db_email',email);setCookie('db_pass',password);setAuthUser(user);
      const snap=await getDoc(doc(db,"users",user.uid));
      if(snap.exists()){setProfile(snap.data());setScreen("app");}
      else{setScreen("setup");setSetupStep(0);}
    }catch(e){
      const msgs={"auth/email-already-in-use":"Email deja folosit!","auth/weak-password":"Parola prea slabă (min 6 caractere)","auth/invalid-email":"Email invalid","auth/invalid-credential":"Email sau parolă greșită"};
      setAuthError(msgs[e.code]||e.message);
    }
  }

  async function handleSetupNext(){
    if(setupStep===0&&!setupData.name.trim())return;
    if(setupStep<3){setSetupStep(s=>s+1);return;}
    const userData={uid:authUser.uid,email:authUser.email,name:setupData.name,emoji:setupData.emoji,drink:setupData.drink||"Ceva tare",bio:setupData.bio||"Omul misterios de la bar.",avgRating:0,totalRatings:0,ratings:[],lat:null,lon:null,createdAt:serverTimestamp()};
    await setDoc(doc(db,"users",authUser.uid),userData);
    setProfile(userData);setScreen("app");
  }

  function requestGeo(){
    if(!navigator.geolocation){setGeoError("Browserul nu suportă geolocation");return;}
    navigator.geolocation.getCurrentPosition(async(pos)=>{
      const{latitude:lat,longitude:lon}=pos.coords;
      setGeo({lat,lon});
      if(authUser){await updateDoc(doc(db,"users",authUser.uid),{lat,lon,lastSeen:serverTimestamp()});setProfile(p=>({...p,lat,lon}));}
    },()=>setGeoError("Nu ai dat acces la locație."));
  }

  function handleImageSelect(e){const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024){showToast("Poza e prea mare! Max 10MB");return;}setPostImage(file);setPostImagePreview(URL.createObjectURL(file));}
  function removeImage(){setPostImage(null);setPostImagePreview(null);if(fileInputRef.current)fileInputRef.current.value="";}

  async function submitPost(){
    if(!newPost.trim()&&!postImage)return;
    setUploadingPost(true);
    try{
      let imageUrl=null;
      if(postImage){showToast("Se încarcă poza... 📸");imageUrl=await uploadToImgbb(postImage);}
      await addDoc(collection(db,"posts"),{userId:authUser.uid,userName:profile.name,userEmoji:profile.emoji,text:newPost,drink:selectedDrink,likes:[],commentCount:0,imageUrl,createdAt:serverTimestamp()});
      setNewPost("");removeImage();showToast("Postare publicată! 🍻");
    }catch(e){showToast("Eroare la upload!");}
    setUploadingPost(false);
  }

  async function toggleLike(postId,likes){const uid=authUser.uid;await updateDoc(doc(db,"posts",postId),{likes:likes.includes(uid)?likes.filter(l=>l!==uid):[...likes,uid]});}

  async function submitComment(postId){
    if(!newComment.trim())return;
    await addDoc(collection(db,"posts",postId,"comments"),{userId:authUser.uid,userName:profile.name,userEmoji:profile.emoji,text:newComment,createdAt:serverTimestamp()});
    await updateDoc(doc(db,"posts",postId),{commentCount:(posts.find(p=>p.id===postId)?.commentCount||0)+1});
    setNewComment("");showToast("Comentariu adăugat! 💬");
  }

  async function submitReview(){
    if(!reviewText.trim())return;
    const review={from:authUser.uid,fromName:profile.name,text:reviewText,rating:reviewRating,time:Date.now()};
    const newRatings=[...(reviewTarget.ratings||[]),review];
    const avg=newRatings.reduce((s,r)=>s+r.rating,0)/newRatings.length;
    await updateDoc(doc(db,"users",reviewTarget.id),{ratings:newRatings,avgRating:Math.round(avg*10)/10,totalRatings:newRatings.length});
    setReviewTarget(null);setReviewText("");setReviewRating(5);showToast("Recenzie trimisă! ⭐");
  }

  async function sendMessage(){
    if(!newMsg.trim()||!chatWith)return;
    const chatId=getChatId(authUser.uid,chatWith.id);
    await addDoc(collection(db,"chats",chatId,"messages"),{text:newMsg,senderId:authUser.uid,senderName:profile.name,senderEmoji:profile.emoji,createdAt:serverTimestamp()});
    await setDoc(doc(db,"conversations",chatId),{participants:[authUser.uid,chatWith.id],participantNames:{[authUser.uid]:profile.name,[chatWith.id]:chatWith.name},participantEmojis:{[authUser.uid]:profile.emoji,[chatWith.id]:chatWith.emoji},lastMessage:newMsg,lastSenderId:authUser.uid,lastMessageAt:serverTimestamp(),readBy:[authUser.uid]},{merge:true});
    setNewMsg("");
  }

  function openChat(user){setChatWith(user);setViewProfile(null);setTab("messages");}
  async function handleSignOut(){deleteCookie('db_email');deleteCookie('db_pass');await signOut(auth);setScreen("auth");setProfile(null);setAuthUser(null);}

  const leaderboard=allUsers.map(u=>{
    const uPosts=posts.filter(p=>p.userId===u.id);
    const totalLikes=uPosts.reduce((s,p)=>s+(p.likes||[]).length,0);
    const totalPosts=uPosts.length;
    const totalComments=uPosts.reduce((s,p)=>s+(p.commentCount||0),0);
    const score=totalLikes*3+totalPosts*2+totalComments+(u.totalRatings||0)*2;
    const badges=computeBadges({...u,id:u.id},posts,allUsers);
    return{...u,totalLikes,totalPosts,totalComments,score,badges};
  }).sort((a,b)=>b.score-a.score);

  const myStats=leaderboard.find(u=>u.id===authUser?.uid);
  const myRank=leaderboard.findIndex(u=>u.id===authUser?.uid)+1;
  const nearbyUsers=allUsers.filter(u=>u.id!==authUser?.uid&&u.lat&&geo&&distKm(geo.lat,geo.lon,u.lat,u.lon)<=radius);

  // Search results
  const searchResults = globalSearch.trim() ? allUsers.filter(u=>
    u.name?.toLowerCase().includes(globalSearch.toLowerCase()) ||
    u.drink?.toLowerCase().includes(globalSearch.toLowerCase()) ||
    u.bio?.toLowerCase().includes(globalSearch.toLowerCase())
  ) : [];

  const filteredUsers = allUsers.filter(u=>u.id!==authUser?.uid).filter(u=>
    !searchQuery ||
    u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.drink?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if(screen==="splash")return(<div style={S.splash}><div style={S.splashGlow}/><div style={{textAlign:"center",zIndex:1}}><div style={{fontSize:72,marginBottom:12}}>🍺</div><div style={S.splashTitle}>DRUNKBOOK</div><div style={{color:"#888",fontSize:13,marginTop:8,letterSpacing:2}}>Rețeaua Socială a Celor Însetați</div><div style={S.splashLoader}><div style={S.splashBar}/></div></div></div>);
  if(loading)return(<div style={{...S.splash}}><div style={{fontSize:40}}>🍺</div><div style={{color:"#f5a623",marginTop:12}}>Se încarcă...</div></div>);

  if(screen==="auth")return(
    <div style={S.root}><div style={S.loginWrap}>
      <div style={{fontSize:56,textAlign:"center"}}>🍺</div>
      <div style={S.splashTitle}>DRUNKBOOK</div>
      <div style={{textAlign:"center",color:"#888",fontSize:13,fontStyle:"italic",marginBottom:8}}>Unde toți se cunosc și nimeni nu-și amintește</div>
      <div style={S.authTabs}><button style={{...S.authTab,...(authMode==="login"?S.authTabActive:{})}} onClick={()=>setAuthMode("login")}>Intră</button><button style={{...S.authTab,...(authMode==="register"?S.authTabActive:{})}} onClick={()=>setAuthMode("register")}>Cont Nou</button></div>
      <input style={S.input} type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}/>
      <input style={S.input} type="password" placeholder="Parolă (min 6 caractere)" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAuth()}/>
      {authError&&<div style={{color:"#e87070",fontSize:13,textAlign:"center"}}>{authError}</div>}
      <button style={S.btnPrimary} onClick={handleAuth}>{authMode==="login"?"🍺 Intră în Bar!":"🎉 Crează Cont"}</button>
    </div></div>
  );

  if(screen==="setup")return(
    <div style={S.root}><div style={S.loginWrap}>
      <div style={S.setupHeader}><button style={S.backBtn} onClick={()=>setupStep>0&&setSetupStep(s=>s-1)}>←</button><span style={{color:"#888",fontSize:13}}>Pas {setupStep+1} / 4</span></div>
      {setupStep===0&&<><div style={S.setupQ}>Cum te cheamă, bețivule?</div><input style={S.input} placeholder="Numele tău de bar..." value={setupData.name} onChange={e=>setSetupData(d=>({...d,name:e.target.value}))} autoFocus/></>}
      {setupStep===1&&<><div style={S.setupQ}>Alege-ți emoji-ul</div><div style={S.emojiGrid}>{DRINKS.map(e=><button key={e} style={{...S.emojiBtn,...(setupData.emoji===e?S.emojiBtnActive:{})}} onClick={()=>setSetupData(d=>({...d,emoji:e}))}>{e}</button>)}</div></>}
      {setupStep===2&&<><div style={S.setupQ}>Băutura ta favorită?</div><input style={S.input} placeholder="ex: Bere, Whisky, Vin roșu..." value={setupData.drink} onChange={e=>setSetupData(d=>({...d,drink:e.target.value}))} autoFocus/></>}
      {setupStep===3&&<><div style={S.setupQ}>Spune ceva despre tine</div><textarea style={{...S.input,height:100,resize:"none"}} placeholder="Bio-ul tău de bar..." value={setupData.bio} onChange={e=>setSetupData(d=>({...d,bio:e.target.value}))} autoFocus/></>}
      <button style={S.btnPrimary} onClick={handleSetupNext}>{setupStep<3?"Continuă →":"🍺 Intră în Bar!"}</button>
    </div></div>
  );

  return(
    <div style={S.root}>
      {toast&&<div style={S.toast}>{toast}</div>}
      {lightboxImg&&(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.95)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setLightboxImg(null)}><img src={lightboxImg} alt="" style={{maxWidth:"95vw",maxHeight:"90vh",borderRadius:12,objectFit:"contain"}}/><button style={{position:"absolute",top:20,right:20,background:"#2a2a2a",border:"none",color:"#fff",width:36,height:36,borderRadius:"50%",fontSize:18,cursor:"pointer"}}>✕</button></div>)}
      {badgeTooltip&&(<div style={{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:"#1a1a1a",border:"1px solid #f5a623",borderRadius:16,padding:20,zIndex:400,textAlign:"center",minWidth:200}} onClick={()=>setBadgeTooltip(null)}><div style={{fontSize:48,marginBottom:8}}>{badgeTooltip.icon}</div><div style={{fontWeight:700,color:"#f5a623",fontSize:16,marginBottom:6}}>{badgeTooltip.name}</div><div style={{color:"#aaa",fontSize:13}}>{badgeTooltip.desc}</div><div style={{color:"#666",fontSize:11,marginTop:12}}>Apasă pentru a închide</div></div>)}

      {/* Global Search Overlay */}
      {showGlobalSearch&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.95)",zIndex:300,padding:20}} onClick={()=>{setShowGlobalSearch(false);setGlobalSearch("");}}>
          <div onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",gap:10,marginBottom:16,marginTop:50}}>
              <input ref={searchRef} style={{...S.input,flex:1,fontSize:18,padding:"14px 16px"}} placeholder="🔍 Caută useri..." value={globalSearch} onChange={e=>setGlobalSearch(e.target.value)} autoFocus/>
              <button style={{background:"#2a2a2a",border:"none",borderRadius:10,padding:"14px 16px",color:"#888",cursor:"pointer",fontSize:16}} onClick={()=>{setShowGlobalSearch(false);setGlobalSearch("");}}>✕</button>
            </div>
            {globalSearch&&searchResults.length===0&&<div style={{textAlign:"center",color:"#666",fontSize:16,marginTop:40,fontStyle:"italic"}}>Niciun utilizator găsit 🍺</div>}
            {searchResults.map(u=>(
              <div key={u.id} style={{background:"#171717",border:"1px solid #242424",borderRadius:14,padding:14,marginBottom:10,display:"flex",alignItems:"center",gap:12,cursor:"pointer"}} onClick={()=>{setViewProfile(u);setShowGlobalSearch(false);setGlobalSearch("");}}>
                <span style={{fontSize:32}}>{u.emoji}</span>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:16,color:"#f5a623"}}>{u.name}</div>
                  <div style={{color:"#888",fontSize:13}}>{u.drink}</div>
                  {u.bio&&<div style={{color:"#666",fontSize:12,marginTop:2,fontStyle:"italic"}}>{u.bio.slice(0,50)}{u.bio.length>50?"...":""}</div>}
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{color:"#f5a623",fontSize:13}}>{"★".repeat(Math.round(u.avgRating||0))}</div>
                  <div style={{color:"#888",fontSize:11}}>{u.totalRatings||0} recenzii</div>
                </div>
              </div>
            ))}
            {!globalSearch&&<div style={{textAlign:"center",color:"#555",fontSize:14,marginTop:60,fontStyle:"italic"}}>Scrie un nume sau o băutură...</div>}
          </div>
        </div>
      )}

      <div style={S.header}>
        <span style={{fontWeight:900,fontSize:18,letterSpacing:3,color:"#f5a623"}}>🍺 DRUNKBOOK</span>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button style={{background:"#1e1e1e",border:"1px solid #2a2a2a",borderRadius:"50%",width:38,height:38,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#888"}} onClick={()=>setShowGlobalSearch(true)}>🔍</button>
          <button style={S.avatarBtn} onClick={()=>setViewProfile({...profile,id:authUser.uid})}>{profile?.emoji}</button>
        </div>
      </div>

      <div style={S.content}>

        {tab==="feed"&&(<div>
          <div style={S.composer}>
            <div style={{display:"flex",gap:10,marginBottom:10}}><span style={{fontSize:28}}>{profile?.emoji}</span><textarea style={S.composerInput} placeholder="Ce bei și ce gândești?" value={newPost} onChange={e=>setNewPost(e.target.value)} rows={2}/></div>
            {postImagePreview&&(<div style={{position:"relative",marginBottom:10}}><img src={postImagePreview} alt="" style={{width:"100%",maxHeight:200,objectFit:"cover",borderRadius:10}}/><button onClick={removeImage} style={{position:"absolute",top:6,right:6,background:"rgba(0,0,0,0.7)",border:"none",color:"#fff",width:28,height:28,borderRadius:"50%",cursor:"pointer",fontSize:14}}>✕</button></div>)}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
                {DRINKS.map(d=><button key={d} style={{...S.drinkBtn,...(selectedDrink===d?S.drinkBtnActive:{})}} onClick={()=>setSelectedDrink(d)}>{d}</button>)}
                <button style={{...S.drinkBtn,color:"#f5a623",borderColor:"#f5a623",fontSize:18}} onClick={()=>fileInputRef.current?.click()}>📸</button>
                <input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImageSelect}/>
              </div>
              <button style={{...S.postBtn,opacity:uploadingPost?0.6:1}} onClick={submitPost} disabled={uploadingPost}>{uploadingPost?"Se încarcă...":"Postează"}</button>
            </div>
          </div>
          {posts.map(post=>(
            <div key={post.id} style={S.postCard}>
              <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
                <button style={S.postAvatar} onClick={()=>{const u=allUsers.find(u=>u.id===post.userId);if(u)setViewProfile(u);}}>{post.userEmoji}</button>
                <div style={{flex:1}}><div style={{fontWeight:700,fontSize:15,color:"#f5a623"}}>{post.userName}</div><div style={{color:"#666",fontSize:12}}>{post.drink} · {timeAgo(post.createdAt)}</div></div>
                {post.userId!==authUser.uid&&<button style={{background:"none",border:"none",cursor:"pointer",fontSize:18,padding:"4px 8px"}} onClick={()=>{const u=allUsers.find(u=>u.id===post.userId);if(u)openChat(u);}}>💬</button>}
              </div>
              {post.text&&<div style={{fontSize:15,lineHeight:1.6,color:"#ddd",marginBottom:post.imageUrl?10:12}}>{post.text}</div>}
              {post.imageUrl&&(<div style={{marginBottom:12,cursor:"pointer"}} onClick={()=>setLightboxImg(post.imageUrl)}><img src={post.imageUrl} alt="" style={{width:"100%",maxHeight:300,objectFit:"cover",borderRadius:10}}/></div>)}
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button style={S.likeBtn} onClick={()=>toggleLike(post.id,post.likes||[])}>🍻 {(post.likes||[]).length}{(post.likes||[]).includes(authUser.uid)?" · cheers!":""}</button>
                <button style={{...S.likeBtn,color:openComments===post.id?"#f5a623":"#ccc",borderColor:openComments===post.id?"#f5a623":"#2a2a2a"}} onClick={()=>{setOpenComments(openComments===post.id?null:post.id);setNewComment("");setTimeout(()=>commentInputRef.current?.focus(),200);}}>💬 {post.commentCount||0}</button>
              </div>
              {openComments===post.id&&(
                <div style={{marginTop:12,borderTop:"1px solid #242424",paddingTop:12}}>
                  {(comments[post.id]||[]).map(c=>(<div key={c.id} style={{display:"flex",gap:8,marginBottom:10}}><span style={{fontSize:20,flexShrink:0}}>{c.userEmoji}</span><div style={{background:"#1e1e1e",borderRadius:"4px 12px 12px 12px",padding:"8px 12px",flex:1}}><div style={{fontWeight:700,fontSize:12,color:"#f5a623",marginBottom:3}}>{c.userName} <span style={{color:"#555",fontWeight:400}}>· {timeAgo(c.createdAt)}</span></div><div style={{fontSize:14,color:"#ddd",lineHeight:1.5}}>{c.text}</div></div></div>))}
                  {(comments[post.id]||[]).length===0&&<div style={{color:"#555",fontSize:13,fontStyle:"italic",marginBottom:10}}>Fii primul care comentează! 🍺</div>}
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{fontSize:22}}>{profile?.emoji}</span>
                    <input ref={commentInputRef} style={{...S.input,flex:1,padding:"8px 12px",fontSize:14}} placeholder="Adaugă un comentariu..." value={newComment} onChange={e=>setNewComment(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submitComment(post.id)}/>
                    <button style={{...S.postBtn,padding:"8px 12px",fontSize:16}} onClick={()=>submitComment(post.id)}>→</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {posts.length===0&&<div style={S.emptyState}>🍺 Nicio postare încă.<br/>Fii primul care scrie ceva!</div>}
        </div>)}

        {tab==="map"&&(<div>
          {!geo&&(<div style={{background:"#171717",border:"1px solid #242424",borderRadius:14,padding:16,marginBottom:12,textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:8}}>🗺️</div>
            <div style={{color:"#e8e0d0",fontWeight:700,marginBottom:6}}>Activează locația ca să apari pe hartă</div>
            <button style={S.geoBtn} onClick={requestGeo}>📍 Activează Locația</button>
            {geoError&&<div style={{color:"#e87070",fontSize:13,marginTop:8}}>{geoError}</div>}
          </div>)}
          <LiveMap allUsers={allUsers} currentUser={authUser} geo={geo} onUserClick={(u)=>setViewProfile(u)} onCheckin={()=>{}}/>
        </div>)}

        {tab==="nearby"&&(<div>
          <div style={{marginBottom:16,display:"flex",flexDirection:"column",gap:10}}>
            {geo?<div style={{color:"#4caf82",fontSize:14,fontWeight:600}}>📍 Locație activă</div>:<button style={S.geoBtn} onClick={requestGeo}>📍 Activează Locația</button>}
            {geoError&&<div style={{color:"#e87070",fontSize:13}}>{geoError}</div>}
            <div style={{display:"flex",alignItems:"center",gap:12}}><span style={{color:"#888",fontSize:13,whiteSpace:"nowrap",minWidth:90}}>Raza: {radius} km</span><input type="range" min={1} max={50} value={radius} onChange={e=>setRadius(+e.target.value)} style={{flex:1,accentColor:"#f5a623"}}/></div>
          </div>
          {!geo&&<div style={S.emptyState}>🗺️ Activează locația ca să vezi<br/>cine bea lângă tine.</div>}
          {geo&&nearbyUsers.length===0&&<div style={S.emptyState}>🌵 Niciun bețiv în {radius}km.<br/>Mărește raza sau mergi la bar.</div>}
          {nearbyUsers.map(u=>(<div key={u.id} style={S.nearbyCard}>
            <span style={{fontSize:32,width:44,textAlign:"center"}}>{u.emoji}</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:15}}>{u.name}</div>
              <div style={{color:"#888",fontSize:12}}>📍 {distKm(geo.lat,geo.lon,u.lat,u.lon).toFixed(1)} km · {u.drink}</div>
              {u.checkinName&&<div style={{color:"#f5a623",fontSize:12}}>🍺 {u.checkinName}</div>}
              <div style={{color:"#f5a623",fontSize:13}}>{"★".repeat(Math.round(u.avgRating||0))}<span style={{color:"#888"}}> ({u.totalRatings||0})</span></div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <button style={S.btnSmall} onClick={()=>setViewProfile(u)}>Profil</button>
              <button style={{...S.btnSmall,background:"#1a3a2a",color:"#4caf82",border:"1px solid #4caf82"}} onClick={()=>openChat(u)}>💬</button>
              <button style={{...S.btnSmall,background:"#f5a623",color:"#111",border:"none"}} onClick={()=>{setReviewTarget(u);setReviewText("");setReviewRating(5);}}>⭐</button>
            </div>
          </div>))}
        </div>)}

        {tab==="leaderboard"&&(<div>
          {myStats&&(<div style={{background:"linear-gradient(135deg,#1a1200,#2a2000)",border:"1px solid #f5a623",borderRadius:16,padding:16,marginBottom:20}}>
            <div style={{color:"#f5a623",fontSize:12,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Statisticile Tale</div>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{fontSize:40}}>{myStats.emoji}</div>
              <div><div style={{fontWeight:800,fontSize:18,color:"#f5a623"}}>{myStats.name}</div><div style={{color:"#888",fontSize:13}}>Locul #{myRank} în clasament</div></div>
              <div style={{marginLeft:"auto",textAlign:"center"}}><div style={{fontSize:28,fontWeight:900,color:"#f5a623"}}>{myStats.score}</div><div style={{color:"#888",fontSize:11}}>puncte</div></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
              {[{icon:"🍻",val:myStats.totalLikes,label:"Cheers"},{icon:"📝",val:myStats.totalPosts,label:"Postări"},{icon:"💬",val:myStats.totalComments,label:"Comentarii"}].map(s=>(<div key={s.label} style={{background:"rgba(0,0,0,0.3)",borderRadius:10,padding:"10px 6px",textAlign:"center"}}><div style={{fontSize:20}}>{s.icon}</div><div style={{fontWeight:800,fontSize:18,color:"#f5a623"}}>{s.val}</div><div style={{color:"#888",fontSize:11}}>{s.label}</div></div>))}
            </div>
            <div style={{borderTop:"1px solid #333",paddingTop:12}}>
              <div style={{color:"#888",fontSize:12,marginBottom:8}}>Badge-urile tale:</div>
              {myStats.badges.length===0&&<div style={{color:"#555",fontSize:13,fontStyle:"italic"}}>Încă niciun badge. Fii mai activ! 🍺</div>}
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>{myStats.badges.map(bid=>{const b=BADGE_DEFS.find(x=>x.id===bid);if(!b)return null;return(<button key={bid} style={{background:"#1e1e1e",border:"1px solid #333",borderRadius:20,padding:"6px 12px",display:"flex",alignItems:"center",gap:6,cursor:"pointer",color:"#e8e0d0",fontSize:13}} onClick={()=>setBadgeTooltip(b)}><span>{b.icon}</span><span>{b.name}</span></button>);})}</div>
            </div>
          </div>)}
          <div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>🏆 Clasament</div>
          {leaderboard.map((u,i)=>(<div key={u.id} style={{...S.postCard,borderColor:i===0?"#f5a623":i===1?"#888":i===2?"#cd7f32":"#242424",cursor:"pointer"}} onClick={()=>setViewProfile(u)}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{fontSize:24,width:32,textAlign:"center",fontWeight:900,color:i===0?"#f5a623":i===1?"#aaa":i===2?"#cd7f32":"#666"}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}</div>
              <span style={{fontSize:28}}>{u.emoji}</span>
              <div style={{flex:1}}><div style={{fontWeight:700,fontSize:15,color:u.id===authUser.uid?"#f5a623":"#e8e0d0"}}>{u.name} {u.id===authUser.uid&&"(tu)"}</div><div style={{display:"flex",gap:8,marginTop:4}}>{u.badges.slice(0,3).map(bid=>{const b=BADGE_DEFS.find(x=>x.id===bid);return b?<span key={bid}>{b.icon}</span>:null;})}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontWeight:800,fontSize:18,color:"#f5a623"}}>{u.score}</div><div style={{color:"#888",fontSize:11}}>🍻{u.totalLikes} 📝{u.totalPosts}</div></div>
            </div>
          </div>))}
          <div style={{marginTop:24,borderTop:"1px solid #1e1e1e",paddingTop:16}}>
            <div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Toate Badge-urile</div>
            {BADGE_DEFS.map(b=>(<div key={b.id} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}><span style={{fontSize:24,width:30,textAlign:"center"}}>{b.icon}</span><div><div style={{fontWeight:700,fontSize:14}}>{b.name}</div><div style={{color:"#888",fontSize:12}}>{b.desc}</div></div></div>))}
          </div>
        </div>)}

        {tab==="messages"&&!chatWith&&(<div>
          <div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Conversații</div>
          {conversations.map(conv=>{const otherId=conv.participants.find(p=>p!==authUser.uid);const otherName=conv.participantNames?.[otherId]||"Utilizator";const otherEmoji=conv.participantEmojis?.[otherId]||"🍺";const isUnread=conv.lastSenderId!==authUser.uid&&!(conv.readBy||[]).includes(authUser.uid);const otherUser=allUsers.find(u=>u.id===otherId);return(<div key={conv.id} style={{...S.postCard,cursor:"pointer",borderColor:isUnread?"#f5a623":"#242424"}} onClick={()=>otherUser&&setChatWith(otherUser)}><div style={{display:"flex",gap:12,alignItems:"center"}}><span style={{fontSize:32}}>{otherEmoji}</span><div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,color:isUnread?"#f5a623":"#e8e0d0"}}>{otherName}</div><div style={{color:"#888",fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{conv.lastMessage}</div></div><div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}><span style={{color:"#555",fontSize:11}}>{timeAgo(conv.lastMessageAt)}</span>{isUnread&&<span style={{background:"#f5a623",color:"#111",borderRadius:10,padding:"2px 7px",fontSize:11,fontWeight:700}}>nou</span>}</div></div></div>);})}

          {/* Search in messages */}
          <div style={{marginTop:20}}>
            <input style={{...S.input,marginBottom:12}} placeholder="🔍 Caută după nume sau băutură..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/>
            <div style={{color:"#888",fontSize:13,marginBottom:10}}>{searchQuery?`Rezultate pentru "${searchQuery}":`:"Toți utilizatorii:"}</div>
            {filteredUsers.map(u=>(<div key={u.id} style={{...S.nearbyCard,cursor:"pointer"}} onClick={()=>setChatWith(u)}>
              <span style={{fontSize:28}}>{u.emoji}</span>
              <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14}}>{u.name}</div><div style={{color:"#888",fontSize:12}}>{u.drink}</div></div>
              <button style={{...S.btnSmall,background:"#1a3a2a",color:"#4caf82",border:"1px solid #4caf82"}}>💬 Chat</button>
            </div>))}
            {filteredUsers.length===0&&<div style={{color:"#666",fontSize:14,fontStyle:"italic",textAlign:"center",marginTop:20}}>Niciun utilizator găsit 🍺</div>}
          </div>
        </div>)}

        {tab==="messages"&&chatWith&&(<div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 140px)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingBottom:12,borderBottom:"1px solid #1e1e1e"}}>
            <button style={{background:"none",border:"none",color:"#f5a623",fontSize:22,cursor:"pointer"}} onClick={()=>setChatWith(null)}>←</button>
            <span style={{fontSize:28}}>{chatWith.emoji}</span>
            <div><div style={{fontWeight:700,color:"#f5a623"}}>{chatWith.name}</div><div style={{color:"#888",fontSize:12}}>{chatWith.drink}</div></div>
          </div>
          <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:8,paddingBottom:8}}>
            {messages.length===0&&<div style={{textAlign:"center",color:"#555",marginTop:40,fontStyle:"italic"}}>Începe conversația! 🍺</div>}
            {messages.map(msg=>{const isMe=msg.senderId===authUser.uid;return(<div key={msg.id} style={{display:"flex",justifyContent:isMe?"flex-end":"flex-start"}}><div style={{maxWidth:"75%",background:isMe?"linear-gradient(135deg,#f5a623,#e8890a)":"#1e1e1e",color:isMe?"#111":"#e8e0d0",borderRadius:isMe?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"10px 14px",fontSize:14,lineHeight:1.5}}><div>{msg.text}</div><div style={{fontSize:10,opacity:0.6,marginTop:4,textAlign:"right"}}>{timeAgo(msg.createdAt)}</div></div></div>);})}
            <div ref={messagesEndRef}/>
          </div>
          <div style={{display:"flex",gap:8,paddingTop:8,borderTop:"1px solid #1e1e1e"}}>
            <input style={{...S.input,flex:1,padding:"10px 14px"}} placeholder="Scrie un mesaj..." value={newMsg} onChange={e=>setNewMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMessage()}/>
            <button style={{...S.postBtn,padding:"10px 16px",fontSize:18}} onClick={sendMessage}>→</button>
          </div>
        </div>)}

        {tab==="profile"&&profile&&(<ProfileView user={{...profile,id:authUser.uid}} posts={posts} allUsers={allUsers} isOwn={true} onSignOut={handleSignOut} onLightbox={setLightboxImg} onBadge={setBadgeTooltip} styles={S} timeAgo={timeAgo} getTitle={getTitle} computeBadges={computeBadges} BADGE_DEFS={BADGE_DEFS}/>)}
      </div>

      <div style={S.nav}>
        {[{key:"feed",icon:"🏠",label:"Feed"},{key:"map",icon:"🗺️",label:"Hartă"},{key:"leaderboard",icon:"🏆",label:"Top"},{key:"messages",icon:"💬",label:"Mesaje",badge:unreadCount},{key:"profile",icon:profile?.emoji,label:"Profil"}].map(t=>(
          <button key={t.key} style={{...S.navBtn,...(tab===t.key?S.navBtnActive:{})}} onClick={()=>{setTab(t.key);if(t.key!=="messages")setChatWith(null);setOpenComments(null);}}>
            <div style={{position:"relative",display:"inline-block"}}>
              <span style={{fontSize:20}}>{t.icon}</span>
              {t.badge>0&&<span style={{position:"absolute",top:-4,right:-6,background:"#e87070",color:"#fff",borderRadius:"50%",width:16,height:16,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{t.badge}</span>}
            </div>
            <span style={{fontSize:9,letterSpacing:0.5}}>{t.label}</span>
          </button>
        ))}
      </div>

      {viewProfile&&(<div style={S.modal} onClick={()=>setViewProfile(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><button style={S.modalClose} onClick={()=>setViewProfile(null)}>✕</button><ProfileView user={viewProfile} posts={posts} allUsers={allUsers} isOwn={viewProfile.id===authUser.uid} onReview={u=>{setViewProfile(null);setReviewTarget(u);setReviewText("");setReviewRating(5);}} onChat={u=>openChat(u)} onLightbox={setLightboxImg} onBadge={setBadgeTooltip} styles={S} timeAgo={timeAgo} getTitle={getTitle} computeBadges={computeBadges} BADGE_DEFS={BADGE_DEFS}/></div></div>)}

      {reviewTarget&&(<div style={S.modal} onClick={()=>setReviewTarget(null)}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><button style={S.modalClose} onClick={()=>setReviewTarget(null)}>✕</button><div style={{fontSize:18,fontWeight:700,color:"#f5a623",marginBottom:16,textAlign:"center"}}>Recenzie pentru {reviewTarget.name}</div><div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:8}}>{[1,2,3,4,5].map(s=><button key={s} style={{background:"none",border:"none",cursor:"pointer",padding:2}} onMouseEnter={()=>setHoverRating(s)} onMouseLeave={()=>setHoverRating(0)} onClick={()=>setReviewRating(s)}><span style={{fontSize:28,color:s<=(hoverRating||reviewRating)?"#f5a623":"#444"}}>★</span></button>)}</div><div style={{textAlign:"center",color:"#f5a623",marginBottom:12,fontSize:14}}>{["","Dezamăgire totală","Poate cu noroc","Ok, nimic special","Bun tovarăș","Legendă!"][hoverRating||reviewRating]}</div><textarea style={{...S.input,height:90,resize:"none"}} placeholder="Povestește ce știi despre el/ea..." value={reviewText} onChange={e=>setReviewText(e.target.value)}/><button style={S.btnPrimary} onClick={submitReview}>Trimite Recenzia 🍺</button></div></div>)}
    </div>
  );
}

function ProfileView({user,posts,allUsers,isOwn,onSignOut,onReview,onChat,onLightbox,onBadge,styles:S,timeAgo,getTitle,computeBadges,BADGE_DEFS}){
  const userPosts=posts.filter(p=>p.userId===user.id);
  const totalLikes=userPosts.reduce((s,p)=>s+(p.likes||[]).length,0);
  const badges=computeBadges({...user,id:user.id||user.uid},posts,allUsers||[]);
  return(<div style={{paddingBottom:20}}>
    <div style={{textAlign:"center",paddingBottom:20,borderBottom:"1px solid #1e1e1e",marginBottom:16}}>
      <div style={{fontSize:64,marginBottom:8}}>{user.emoji}</div>
      <div style={{fontSize:22,fontWeight:800,color:"#f5a623"}}>{user.name}</div>
      <div style={{color:"#888",fontSize:13,fontStyle:"italic",marginTop:4}}>{getTitle(user.avgRating)}</div>
      <div style={{color:"#bbb",fontSize:14,marginTop:6}}>🥤 {user.drink}</div>
      <div style={{color:"#aaa",fontSize:14,marginTop:10,fontStyle:"italic",lineHeight:1.6}}>{user.bio}</div>
      <div style={{marginTop:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><span style={{color:"#f5a623",fontSize:20}}>{"★".repeat(Math.round(user.avgRating||0))}</span><span style={{color:"#888",fontSize:12}}>{user.avgRating||0} ({user.totalRatings||0} recenzii)</span></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:14}}>{[{icon:"📝",val:userPosts.length,label:"Postări"},{icon:"🍻",val:totalLikes,label:"Cheers"},{icon:"⭐",val:user.totalRatings||0,label:"Recenzii"}].map(s=>(<div key={s.label} style={{background:"#1a1a1a",borderRadius:10,padding:"8px 4px",textAlign:"center"}}><div style={{fontSize:18}}>{s.icon}</div><div style={{fontWeight:800,fontSize:16,color:"#f5a623"}}>{s.val}</div><div style={{color:"#888",fontSize:11}}>{s.label}</div></div>))}</div>
      {badges.length>0&&(<div style={{marginTop:14}}><div style={{color:"#888",fontSize:12,marginBottom:8}}>Badge-uri:</div><div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center"}}>{badges.map(bid=>{const b=BADGE_DEFS.find(x=>x.id===bid);if(!b)return null;return(<button key={bid} style={{background:"#1e1e1e",border:"1px solid #333",borderRadius:20,padding:"5px 10px",display:"flex",alignItems:"center",gap:5,cursor:"pointer",color:"#e8e0d0",fontSize:12}} onClick={()=>onBadge&&onBadge(b)}><span>{b.icon}</span><span>{b.name}</span></button>);})}</div></div>)}
      {!isOwn&&<div style={{display:"flex",gap:8,marginTop:12}}>{onReview&&<button style={{...S.btnPrimary,flex:1}} onClick={()=>onReview(user)}>⭐ Recenzie</button>}{onChat&&<button style={{...S.btnPrimary,flex:1,background:"linear-gradient(135deg,#4caf82,#2d8a5e)"}} onClick={()=>onChat(user)}>💬 Mesaj</button>}</div>}
      {isOwn&&onSignOut&&<button style={{...S.btnSmall,marginTop:12,width:"100%",padding:"10px",color:"#e87070",border:"1px solid #e87070"}} onClick={onSignOut}>Deconectare</button>}
    </div>
    {(user.ratings||[]).length>0&&<div style={{marginBottom:16}}><div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Recenzii</div>{[...(user.ratings||[])].reverse().map((r,i)=>(<div key={i} style={{background:"#1a1a1a",borderRadius:10,padding:12,marginBottom:8}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><span style={{color:"#f5a623"}}>{"★".repeat(r.rating)}</span><span style={{fontWeight:700,fontSize:13,color:"#ccc"}}>{r.fromName}</span><span style={{color:"#555",fontSize:12,marginLeft:"auto"}}>{timeAgo({seconds:r.time/1000})}</span></div><div style={{color:"#bbb",fontSize:14,lineHeight:1.5}}>{r.text}</div></div>))}</div>}
    {userPosts.length>0&&<div><div style={{color:"#f5a623",fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Postări</div>{userPosts.map(p=>(<div key={p.id} style={{background:"#1a1a1a",borderRadius:10,padding:12,marginBottom:8}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><span>{p.drink}</span><span style={{color:"#555",fontSize:12,marginLeft:"auto"}}>{timeAgo(p.createdAt)}</span></div>{p.text&&<div style={{color:"#bbb",fontSize:14,lineHeight:1.5,marginBottom:p.imageUrl?8:0}}>{p.text}</div>}{p.imageUrl&&<img src={p.imageUrl} alt="" style={{width:"100%",maxHeight:200,objectFit:"cover",borderRadius:8,cursor:"pointer"}} onClick={()=>onLightbox&&onLightbox(p.imageUrl)}/>}<div style={{color:"#888",fontSize:12,marginTop:6}}>🍻 {(p.likes||[]).length} cheers · 💬 {p.commentCount||0}</div></div>))}</div>}
  </div>);
}

const S={
  splash:{minHeight:"100vh",background:"#0a0a0a",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Georgia,serif",position:"relative",flexDirection:"column"},
  splashGlow:{position:"absolute",width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,rgba(245,166,35,0.25) 0%,transparent 70%)",top:"50%",left:"50%",transform:"translate(-50%,-50%)"},
  splashTitle:{fontSize:36,fontWeight:900,letterSpacing:8,color:"#f5a623",textAlign:"center"},
  splashLoader:{width:200,height:3,background:"#222",borderRadius:2,margin:"24px auto 0",overflow:"hidden"},
  splashBar:{height:"100%",background:"linear-gradient(90deg,#f5a623,#e8890a)",borderRadius:2,animation:"load 2s ease-in-out forwards"},
  root:{minHeight:"100vh",background:"#0f0f0f",color:"#e8e0d0",fontFamily:"Georgia,serif",maxWidth:480,margin:"0 auto",position:"relative"},
  loginWrap:{padding:"40px 24px",display:"flex",flexDirection:"column",gap:14,minHeight:"100vh"},
  authTabs:{display:"flex",background:"#1a1a1a",borderRadius:10,padding:4,gap:4},
  authTab:{flex:1,background:"none",border:"none",color:"#888",padding:"10px",borderRadius:8,cursor:"pointer",fontFamily:"Georgia,serif",fontSize:15},
  authTabActive:{background:"#f5a623",color:"#111",fontWeight:700},
  input:{width:"100%",boxSizing:"border-box",background:"#1a1a1a",border:"1px solid #333",borderRadius:10,padding:"12px 14px",color:"#e8e0d0",fontSize:16,fontFamily:"Georgia,serif",outline:"none"},
  btnPrimary:{background:"linear-gradient(135deg,#f5a623,#e8890a)",color:"#111",border:"none",borderRadius:10,padding:"14px 20px",fontWeight:800,fontSize:16,cursor:"pointer",letterSpacing:1,width:"100%",fontFamily:"Georgia,serif"},
  setupHeader:{display:"flex",alignItems:"center",gap:12,marginBottom:8},
  backBtn:{background:"none",border:"none",color:"#f5a623",fontSize:20,cursor:"pointer",padding:"4px 8px"},
  setupQ:{fontSize:22,fontWeight:700,marginBottom:8,color:"#f5a623"},
  emojiGrid:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12},
  emojiBtn:{fontSize:32,background:"#1a1a1a",border:"2px solid #2a2a2a",borderRadius:12,padding:"12px",cursor:"pointer"},
  emojiBtnActive:{border:"2px solid #f5a623",background:"#2a2000"},
  header:{position:"sticky",top:0,zIndex:50,background:"rgba(15,15,15,0.95)",backdropFilter:"blur(10px)",borderBottom:"1px solid #1e1e1e",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px"},
  avatarBtn:{background:"#1e1e1e",border:"1px solid #2a2a2a",borderRadius:"50%",width:38,height:38,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"},
  content:{padding:16,paddingBottom:80},
  composer:{background:"#171717",border:"1px solid #242424",borderRadius:14,padding:14,marginBottom:16},
  composerInput:{flex:1,background:"none",border:"none",color:"#e8e0d0",fontSize:15,resize:"none",outline:"none",fontFamily:"Georgia,serif",width:"100%"},
  drinkBtn:{background:"none",border:"1px solid #2a2a2a",borderRadius:8,padding:"4px 6px",fontSize:16,cursor:"pointer"},
  drinkBtnActive:{background:"#2a2000",border:"1px solid #f5a623"},
  postBtn:{background:"#f5a623",color:"#111",border:"none",borderRadius:8,padding:"8px 16px",fontWeight:800,cursor:"pointer",fontFamily:"Georgia,serif"},
  postCard:{background:"#171717",border:"1px solid #242424",borderRadius:14,padding:14,marginBottom:12},
  postAvatar:{fontSize:26,background:"#1e1e1e",border:"1px solid #2a2a2a",borderRadius:"50%",width:40,height:40,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0},
  likeBtn:{background:"#1e1e1e",border:"1px solid #2a2a2a",borderRadius:8,padding:"6px 12px",color:"#ccc",cursor:"pointer",fontSize:13,fontFamily:"Georgia,serif"},
  geoBtn:{background:"#1e1e1e",border:"1px solid #f5a623",color:"#f5a623",borderRadius:10,padding:"10px 16px",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14},
  emptyState:{textAlign:"center",color:"#666",fontSize:16,lineHeight:1.8,marginTop:60,fontStyle:"italic"},
  nearbyCard:{background:"#171717",border:"1px solid #242424",borderRadius:14,padding:14,marginBottom:12,display:"flex",alignItems:"center",gap:12},
  btnSmall:{background:"#1e1e1e",border:"1px solid #2a2a2a",color:"#e8e0d0",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif",whiteSpace:"nowrap"},
  nav:{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"rgba(10,10,10,0.97)",backdropFilter:"blur(10px)",borderTop:"1px solid #1e1e1e",display:"flex",zIndex:100},
  navBtn:{flex:1,background:"none",border:"none",color:"#666",cursor:"pointer",padding:"10px 0 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:3,fontFamily:"Georgia,serif"},
  navBtnActive:{color:"#f5a623"},
  modal:{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(4px)"},
  modalBox:{background:"#141414",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:480,maxHeight:"85vh",overflowY:"auto",padding:20,position:"relative",borderTop:"1px solid #2a2a2a"},
  modalClose:{position:"absolute",top:16,right:16,background:"#2a2a2a",border:"none",color:"#ccc",width:32,height:32,borderRadius:"50%",cursor:"pointer",fontSize:14},
  toast:{position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",background:"#f5a623",color:"#111",padding:"10px 20px",borderRadius:30,fontWeight:700,fontSize:14,zIndex:300,whiteSpace:"nowrap",boxShadow:"0 4px 20px rgba(245,166,35,0.4)"},
};
