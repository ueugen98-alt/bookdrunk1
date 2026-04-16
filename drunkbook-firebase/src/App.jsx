import { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc, setDoc, getDoc, collection, addDoc, onSnapshot,
  query, orderBy, updateDoc, arrayUnion, serverTimestamp, getDocs
} from "firebase/firestore";

const DRINKS = ["🍺","🍻","🥃","🍷","🍸","🍹","🥂","🍾"];
const TITLES = ["Încă Sobru","Prima Bere","Al Doilea Rând","Vibe Check","Deja Fluent","Filozoful Barului","Regele Mesei","Legendă Vie"];

function getTitle(r) {
  if (!r || r < 1) return TITLES[0];
  if (r < 2) return TITLES[1];
  if (r < 3) return TITLES[2];
  if (r < 4) return TITLES[3];
  if (r < 5) return TITLES[4];
  if (r < 6) return TITLES[5];
  if (r < 8) return TITLES[6];
  return TITLES[7];
}

function distKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - (ts.seconds ? ts.seconds * 1000 : ts);
  if (diff < 60000) return "acum";
  if (diff < 3600000) return Math.floor(diff/60000) + " min";
  if (diff < 86400000) return Math.floor(diff/3600000) + "h";
  return Math.floor(diff/86400000) + "z";
}

export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("splash");
  const [tab, setTab] = useState("feed");

  // Auth forms
  const [authMode, setAuthMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // Setup
  const [setupStep, setSetupStep] = useState(0);
  const [setupData, setSetupData] = useState({ name: "", emoji: "🍺", drink: "", bio: "" });

  // Feed
  const [posts, setPosts] = useState([]);
  const [newPost, setNewPost] = useState("");
  const [selectedDrink, setSelectedDrink] = useState("🍺");

  // Nearby
  const [geo, setGeo] = useState(null);
  const [geoError, setGeoError] = useState("");
  const [radius, setRadius] = useState(10);
  const [allUsers, setAllUsers] = useState([]);

  // Profile/Review modal
  const [viewProfile, setViewProfile] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewText, setReviewText] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);

  const [toast, setToast] = useState(null);

  // Splash
  useEffect(() => {
    const t = setTimeout(() => setScreen("auth"), 2200);
    return () => clearTimeout(t);
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          setProfile(snap.data());
          setScreen("app");
        } else {
          setScreen("setup");
          setSetupStep(0);
        }
      } else {
        setProfile(null);
        if (screen !== "splash") setScreen("auth");
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  // Listen to posts
  useEffect(() => {
    if (screen !== "app") return;
    const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [screen]);

  // Listen to all users (for nearby)
  useEffect(() => {
    if (screen !== "app") return;
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [screen]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  // Auth handlers
  async function handleAuth() {
    setAuthError("");
    try {
      if (authMode === "register") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (e) {
      const msgs = {
        "auth/email-already-in-use": "Email deja folosit!",
        "auth/weak-password": "Parola prea slabă (min 6 caractere)",
        "auth/invalid-email": "Email invalid",
        "auth/user-not-found": "Nu există cont cu acest email",
        "auth/wrong-password": "Parolă greșită",
        "auth/invalid-credential": "Email sau parolă greșită",
      };
      setAuthError(msgs[e.code] || e.message);
    }
  }

  // Setup handler
  async function handleSetupNext() {
    if (setupStep === 0 && !setupData.name.trim()) return;
    if (setupStep < 3) { setSetupStep(s => s+1); return; }
    const userData = {
      uid: authUser.uid,
      email: authUser.email,
      name: setupData.name,
      emoji: setupData.emoji,
      drink: setupData.drink || "Ceva tare",
      bio: setupData.bio || "Omul misterios de la bar.",
      avgRating: 0,
      totalRatings: 0,
      ratings: [],
      lat: null,
      lon: null,
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, "users", authUser.uid), userData);
    setProfile(userData);
    setScreen("app");
  }

  // Geo
  function requestGeo() {
    if (!navigator.geolocation) { setGeoError("Browserul nu suportă geolocation"); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        setGeo({ lat, lon });
        if (authUser) {
          await updateDoc(doc(db, "users", authUser.uid), { lat, lon });
          setProfile(p => ({ ...p, lat, lon }));
        }
      },
      () => setGeoError("Nu ai dat acces la locație.")
    );
  }

  // Post
  async function submitPost() {
    if (!newPost.trim()) return;
    await addDoc(collection(db, "posts"), {
      userId: authUser.uid,
      userName: profile.name,
      userEmoji: profile.emoji,
      text: newPost,
      drink: selectedDrink,
      likes: [],
      createdAt: serverTimestamp(),
    });
    setNewPost("");
    showToast("Postare publicată! 🍻");
  }

  // Like
  async function toggleLike(postId, likes) {
    const uid = authUser.uid;
    const newLikes = likes.includes(uid) ? likes.filter(l => l !== uid) : [...likes, uid];
    await updateDoc(doc(db, "posts", postId), { likes: newLikes });
  }

  // Review
  async function submitReview() {
    if (!reviewText.trim()) return;
    const targetRef = doc(db, "users", reviewTarget.id);
    const review = {
      from: authUser.uid,
      fromName: profile.name,
      text: reviewText,
      rating: reviewRating,
      time: Date.now(),
    };
    const newRatings = [...(reviewTarget.ratings || []), review];
    const avg = newRatings.reduce((s,r) => s+r.rating, 0) / newRatings.length;
    await updateDoc(targetRef, {
      ratings: newRatings,
      avgRating: Math.round(avg * 10) / 10,
      totalRatings: newRatings.length,
    });
    setReviewTarget(null);
    setReviewText("");
    setReviewRating(5);
    showToast("Recenzie trimisă! ⭐");
  }

  // Nearby users
  const nearbyUsers = allUsers.filter(u => {
    if (u.id === authUser?.uid || !u.lat || !geo) return false;
    return distKm(geo.lat, geo.lon, u.lat, u.lon) <= radius;
  });

  // ======= SCREENS =======

  if (screen === "splash") return (
    <div style={S.splash}>
      <div style={S.splashGlow} />
      <div style={{textAlign:"center", zIndex:1}}>
        <div style={{fontSize:72, marginBottom:12}}>🍺</div>
        <div style={S.splashTitle}>DRUNKBOOK</div>
        <div style={{color:"#888", fontSize:13, marginTop:8, letterSpacing:2}}>Rețeaua Socială a Celor Însetați</div>
        <div style={S.splashLoader}><div style={S.splashBar} /></div>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{...S.splash}}>
      <div style={{fontSize:40}}>🍺</div>
      <div style={{color:"#f5a623", marginTop:12}}>Se încarcă...</div>
    </div>
  );

  if (screen === "auth") return (
    <div style={S.root}>
      <div style={S.loginWrap}>
        <div style={{fontSize:56, textAlign:"center"}}>🍺</div>
        <div style={S.splashTitle}>DRUNKBOOK</div>
        <div style={{textAlign:"center", color:"#888", fontSize:13, fontStyle:"italic", marginBottom:8}}>
          Unde toți se cunosc și nimeni nu-și amintește
        </div>

        <div style={S.authTabs}>
          <button style={{...S.authTab, ...(authMode==="login"?S.authTabActive:{})}} onClick={()=>setAuthMode("login")}>Intră</button>
          <button style={{...S.authTab, ...(authMode==="register"?S.authTabActive:{})}} onClick={()=>setAuthMode("register")}>Cont Nou</button>
        </div>

        <input style={S.input} type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input style={S.input} type="password" placeholder="Parolă (min 6 caractere)" value={password} onChange={e=>setPassword(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&handleAuth()} />

        {authError && <div style={{color:"#e87070", fontSize:13, textAlign:"center"}}>{authError}</div>}

        <button style={S.btnPrimary} onClick={handleAuth}>
          {authMode === "login" ? "🍺 Intră în Bar!" : "🎉 Crează Cont"}
        </button>
      </div>
    </div>
  );

  if (screen === "setup") return (
    <div style={S.root}>
      <div style={S.loginWrap}>
        <div style={S.setupHeader}>
          <button style={S.backBtn} onClick={()=>setupStep===0?null:setSetupStep(s=>s-1)}>←</button>
          <span style={{color:"#888", fontSize:13}}>Pas {setupStep+1} / 4</span>
        </div>
        {setupStep===0 && <>
          <div style={S.setupQ}>Cum te cheamă, bețivule?</div>
          <input style={S.input} placeholder="Numele tău de bar..." value={setupData.name} onChange={e=>setSetupData(d=>({...d,name:e.target.value}))} autoFocus />
        </>}
        {setupStep===1 && <>
          <div style={S.setupQ}>Alege-ți emoji-ul</div>
          <div style={S.emojiGrid}>
            {DRINKS.map(e => <button key={e} style={{...S.emojiBtn,...(setupData.emoji===e?S.emojiBtnActive:{})}} onClick={()=>setSetupData(d=>({...d,emoji:e}))}>{e}</button>)}
          </div>
        </>}
        {setupStep===2 && <>
          <div style={S.setupQ}>Băutura ta favorită?</div>
          <input style={S.input} placeholder="ex: Bere, Whisky, Vin roșu..." value={setupData.drink} onChange={e=>setSetupData(d=>({...d,drink:e.target.value}))} autoFocus />
        </>}
        {setupStep===3 && <>
          <div style={S.setupQ}>Spune ceva despre tine</div>
          <textarea style={{...S.input,height:100,resize:"none"}} placeholder="Bio-ul tău de bar..." value={setupData.bio} onChange={e=>setSetupData(d=>({...d,bio:e.target.value}))} autoFocus />
        </>}
        <button style={S.btnPrimary} onClick={handleSetupNext}>
          {setupStep<3?"Continuă →":"🍺 Intră în Bar!"}
        </button>
      </div>
    </div>
  );

  // MAIN APP
  return (
    <div style={S.root}>
      {toast && <div style={S.toast}>{toast}</div>}

      <div style={S.header}>
        <span style={{fontWeight:900, fontSize:18, letterSpacing:3, color:"#f5a623"}}>🍺 DRUNKBOOK</span>
        <button style={S.avatarBtn} onClick={()=>setViewProfile({...profile, id: authUser.uid})}>
          {profile?.emoji}
        </button>
      </div>

      <div style={S.content}>
        {/* FEED */}
        {tab==="feed" && (
          <div>
            <div style={S.composer}>
              <div style={{display:"flex", gap:10, marginBottom:10}}>
                <span style={{fontSize:28}}>{profile?.emoji}</span>
                <textarea style={S.composerInput} placeholder="Ce bei și ce gândești?" value={newPost} onChange={e=>setNewPost(e.target.value)} rows={2} />
              </div>
              <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                <div style={{display:"flex", gap:4}}>
                  {DRINKS.map(d => <button key={d} style={{...S.drinkBtn,...(selectedDrink===d?S.drinkBtnActive:{})}} onClick={()=>setSelectedDrink(d)}>{d}</button>)}
                </div>
                <button style={S.postBtn} onClick={submitPost}>Postează</button>
              </div>
            </div>

            {posts.map(post => (
              <div key={post.id} style={S.postCard}>
                <div style={{display:"flex", gap:10, alignItems:"center", marginBottom:10}}>
                  <button style={S.postAvatar} onClick={()=>{
                    const u = allUsers.find(u=>u.id===post.userId);
                    if(u) setViewProfile(u);
                  }}>{post.userEmoji}</button>
                  <div>
                    <div style={{fontWeight:700, fontSize:15, color:"#f5a623"}}>{post.userName}</div>
                    <div style={{color:"#666", fontSize:12}}>{post.drink} · {timeAgo(post.createdAt)}</div>
                  </div>
                </div>
                <div style={{fontSize:15, lineHeight:1.6, color:"#ddd", marginBottom:10}}>{post.text}</div>
                <button style={S.likeBtn} onClick={()=>toggleLike(post.id, post.likes||[])}>
                  🍻 {(post.likes||[]).length} {(post.likes||[]).includes(authUser.uid) ? "· cheers!" : ""}
                </button>
              </div>
            ))}
            {posts.length===0 && <div style={S.emptyState}>🍺 Nicio postare încă.<br/>Fii primul care scrie ceva!</div>}
          </div>
        )}

        {/* NEARBY */}
        {tab==="nearby" && (
          <div>
            <div style={{marginBottom:16, display:"flex", flexDirection:"column", gap:10}}>
              {geo
                ? <div style={{color:"#4caf82", fontSize:14, fontWeight:600}}>📍 Locație activă</div>
                : <button style={S.geoBtn} onClick={requestGeo}>📍 Activează Locația</button>
              }
              {geoError && <div style={{color:"#e87070", fontSize:13}}>{geoError}</div>}
              <div style={{display:"flex", alignItems:"center", gap:12}}>
                <span style={{color:"#888", fontSize:13, whiteSpace:"nowrap", minWidth:90}}>Raza: {radius} km</span>
                <input type="range" min={1} max={50} value={radius} onChange={e=>setRadius(+e.target.value)} style={{flex:1, accentColor:"#f5a623"}} />
              </div>
            </div>

            {!geo && <div style={S.emptyState}>🗺️ Activează locația ca să vezi<br/>cine bea lângă tine.</div>}
            {geo && nearbyUsers.length===0 && <div style={S.emptyState}>🌵 Niciun bețiv în {radius}km.<br/>Mărește raza sau mergi la bar.</div>}

            {nearbyUsers.map(u => (
              <div key={u.id} style={S.nearbyCard}>
                <span style={{fontSize:32, width:44, textAlign:"center"}}>{u.emoji}</span>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700, fontSize:15}}>{u.name}</div>
                  <div style={{color:"#888", fontSize:12}}>📍 {distKm(geo.lat,geo.lon,u.lat,u.lon).toFixed(1)} km · {u.drink}</div>
                  <div style={{color:"#f5a623", fontSize:13}}>{"★".repeat(Math.round(u.avgRating||0))} <span style={{color:"#888"}}>({u.totalRatings||0})</span></div>
                </div>
                <div style={{display:"flex", flexDirection:"column", gap:6}}>
                  <button style={S.btnSmall} onClick={()=>setViewProfile(u)}>Profil</button>
                  {u.id !== authUser.uid && <button style={{...S.btnSmall, background:"#f5a623", color:"#111"}} onClick={()=>{setReviewTarget(u);setReviewText("");setReviewRating(5);}}>⭐</button>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* PROFILE TAB */}
        {tab==="profile" && profile && (
          <ProfileView
            user={{...profile, id: authUser.uid}}
            posts={posts}
            isOwn={true}
            onSignOut={async()=>{await signOut(auth); setScreen("auth"); setProfile(null);}}
            styles={S} timeAgo={timeAgo} getTitle={getTitle}
          />
        )}
      </div>

      {/* NAV */}
      <div style={S.nav}>
        {[{key:"feed",icon:"🏠",label:"Feed"},{key:"nearby",icon:"📍",label:"Aproape"},{key:"profile",icon:profile?.emoji,label:"Profil"}].map(t=>(
          <button key={t.key} style={{...S.navBtn,...(tab===t.key?S.navBtnActive:{})}} onClick={()=>setTab(t.key)}>
            <span style={{fontSize:22}}>{t.icon}</span>
            <span style={{fontSize:10, letterSpacing:1}}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* PROFILE MODAL */}
      {viewProfile && (
        <div style={S.modal} onClick={()=>setViewProfile(null)}>
          <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
            <button style={S.modalClose} onClick={()=>setViewProfile(null)}>✕</button>
            <ProfileView
              user={viewProfile}
              posts={posts}
              isOwn={viewProfile.id===authUser.uid}
              onReview={u=>{setViewProfile(null);setReviewTarget(u);setReviewText("");setReviewRating(5);}}
              styles={S} timeAgo={timeAgo} getTitle={getTitle}
            />
          </div>
        </div>
      )}

      {/* REVIEW MODAL */}
      {reviewTarget && (
        <div style={S.modal} onClick={()=>setReviewTarget(null)}>
          <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
            <button style={S.modalClose} onClick={()=>setReviewTarget(null)}>✕</button>
            <div style={{fontSize:18, fontWeight:700, color:"#f5a623", marginBottom:16, textAlign:"center"}}>
              Recenzie pentru {reviewTarget.name}
            </div>
            <div style={{display:"flex", justifyContent:"center", gap:8, marginBottom:8}}>
              {[1,2,3,4,5].map(s=>(
                <button key={s} style={{background:"none",border:"none",cursor:"pointer",padding:2}}
                  onMouseEnter={()=>setHoverRating(s)} onMouseLeave={()=>setHoverRating(0)}
                  onClick={()=>setReviewRating(s)}>
                  <span style={{fontSize:28, color: s<=(hoverRating||reviewRating)?"#f5a623":"#444"}}>★</span>
                </button>
              ))}
            </div>
            <div style={{textAlign:"center", color:"#f5a623", marginBottom:12, fontSize:14}}>
              {["","Dezamăgire totală","Poate cu noroc","Ok, nimic special","Bun tovarăș","Legendă!"][hoverRating||reviewRating]}
            </div>
            <textarea style={{...S.input, height:90, resize:"none"}} placeholder="Povestește ce știi despre el/ea..." value={reviewText} onChange={e=>setReviewText(e.target.value)} />
            <button style={S.btnPrimary} onClick={submitReview}>Trimite Recenzia 🍺</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileView({ user, posts, isOwn, onSignOut, onReview, styles: S, timeAgo, getTitle }) {
  const userPosts = posts.filter(p => p.userId === user.id);
  return (
    <div style={{paddingBottom:20}}>
      <div style={{textAlign:"center", paddingBottom:20, borderBottom:"1px solid #1e1e1e", marginBottom:16}}>
        <div style={{fontSize:64, marginBottom:8}}>{user.emoji}</div>
        <div style={{fontSize:22, fontWeight:800, color:"#f5a623"}}>{user.name}</div>
        <div style={{color:"#888", fontSize:13, fontStyle:"italic", marginTop:4}}>{getTitle(user.avgRating)}</div>
        <div style={{color:"#bbb", fontSize:14, marginTop:6}}>🥤 {user.drink}</div>
        <div style={{color:"#aaa", fontSize:14, marginTop:10, fontStyle:"italic", lineHeight:1.6}}>{user.bio}</div>
        <div style={{marginTop:12, display:"flex", alignItems:"center", justifyContent:"center", gap:6}}>
          <span style={{color:"#f5a623", fontSize:20}}>{"★".repeat(Math.round(user.avgRating||0))}</span>
          <span style={{color:"#888", fontSize:12}}>{user.avgRating||0} ({user.totalRatings||0} recenzii)</span>
        </div>
        {!isOwn && onReview && (
          <button style={{...S.btnPrimary, marginTop:12}} onClick={()=>onReview(user)}>⭐ Scrie Recenzie</button>
        )}
        {isOwn && onSignOut && (
          <button style={{...S.btnSmall, marginTop:12, width:"100%", padding:"10px", color:"#e87070", border:"1px solid #e87070"}} onClick={onSignOut}>
            Deconectare
          </button>
        )}
      </div>

      {(user.ratings||[]).length > 0 && (
        <div style={{marginBottom:16}}>
          <div style={{color:"#f5a623", fontSize:13, fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:10}}>Recenzii</div>
          {[...(user.ratings||[])].reverse().map((r,i)=>(
            <div key={i} style={{background:"#1a1a1a", borderRadius:10, padding:12, marginBottom:8}}>
              <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:6}}>
                <span style={{color:"#f5a623"}}>{"★".repeat(r.rating)}</span>
                <span style={{fontWeight:700, fontSize:13, color:"#ccc"}}>{r.fromName}</span>
                <span style={{color:"#555", fontSize:12, marginLeft:"auto"}}>{timeAgo({seconds: r.time/1000})}</span>
              </div>
              <div style={{color:"#bbb", fontSize:14, lineHeight:1.5}}>{r.text}</div>
            </div>
          ))}
        </div>
      )}

      {userPosts.length > 0 && (
        <div>
          <div style={{color:"#f5a623", fontSize:13, fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:10}}>Postări</div>
          {userPosts.map(p=>(
            <div key={p.id} style={{background:"#1a1a1a", borderRadius:10, padding:12, marginBottom:8}}>
              <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:6}}>
                <span>{p.drink}</span>
                <span style={{color:"#555", fontSize:12, marginLeft:"auto"}}>{timeAgo(p.createdAt)}</span>
              </div>
              <div style={{color:"#bbb", fontSize:14, lineHeight:1.5}}>{p.text}</div>
              <div style={{color:"#888", fontSize:12, marginTop:4}}>🍻 {(p.likes||[]).length} cheers</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const S = {
  splash: { minHeight:"100vh", background:"#0a0a0a", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Georgia,serif", position:"relative", flexDirection:"column", gap:0 },
  splashGlow: { position:"absolute", width:300, height:300, borderRadius:"50%", background:"radial-gradient(circle,rgba(245,166,35,0.25) 0%,transparent 70%)", top:"50%", left:"50%", transform:"translate(-50%,-50%)" },
  splashTitle: { fontSize:36, fontWeight:900, letterSpacing:8, color:"#f5a623", textAlign:"center", textShadow:"0 0 30px rgba(245,166,35,0.5)" },
  splashLoader: { width:200, height:3, background:"#222", borderRadius:2, margin:"24px auto 0", overflow:"hidden" },
  splashBar: { height:"100%", background:"linear-gradient(90deg,#f5a623,#e8890a)", borderRadius:2, animation:"load 2s ease-in-out forwards" },
  root: { minHeight:"100vh", background:"#0f0f0f", color:"#e8e0d0", fontFamily:"Georgia,serif", maxWidth:480, margin:"0 auto", position:"relative" },
  loginWrap: { padding:"40px 24px", display:"flex", flexDirection:"column", gap:14, minHeight:"100vh" },
  authTabs: { display:"flex", background:"#1a1a1a", borderRadius:10, padding:4, gap:4 },
  authTab: { flex:1, background:"none", border:"none", color:"#888", padding:"10px", borderRadius:8, cursor:"pointer", fontFamily:"Georgia,serif", fontSize:15 },
  authTabActive: { background:"#f5a623", color:"#111", fontWeight:700 },
  input: { width:"100%", boxSizing:"border-box", background:"#1a1a1a", border:"1px solid #333", borderRadius:10, padding:"12px 14px", color:"#e8e0d0", fontSize:16, fontFamily:"Georgia,serif", outline:"none" },
  btnPrimary: { background:"linear-gradient(135deg,#f5a623,#e8890a)", color:"#111", border:"none", borderRadius:10, padding:"14px 20px", fontWeight:800, fontSize:16, cursor:"pointer", letterSpacing:1, width:"100%", fontFamily:"Georgia,serif" },
  setupHeader: { display:"flex", alignItems:"center", gap:12, marginBottom:8 },
  backBtn: { background:"none", border:"none", color:"#f5a623", fontSize:20, cursor:"pointer", padding:"4px 8px" },
  setupQ: { fontSize:22, fontWeight:700, marginBottom:8, color:"#f5a623" },
  emojiGrid: { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 },
  emojiBtn: { fontSize:32, background:"#1a1a1a", border:"2px solid #2a2a2a", borderRadius:12, padding:"12px", cursor:"pointer" },
  emojiBtnActive: { border:"2px solid #f5a623", background:"#2a2000" },
  header: { position:"sticky", top:0, zIndex:50, background:"rgba(15,15,15,0.95)", backdropFilter:"blur(10px)", borderBottom:"1px solid #1e1e1e", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 18px" },
  avatarBtn: { background:"#1e1e1e", border:"1px solid #2a2a2a", borderRadius:"50%", width:38, height:38, fontSize:20, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" },
  content: { padding:16, paddingBottom:80 },
  composer: { background:"#171717", border:"1px solid #242424", borderRadius:14, padding:14, marginBottom:16 },
  composerInput: { flex:1, background:"none", border:"none", color:"#e8e0d0", fontSize:15, resize:"none", outline:"none", fontFamily:"Georgia,serif", width:"100%" },
  drinkBtn: { background:"none", border:"1px solid #2a2a2a", borderRadius:8, padding:"4px 6px", fontSize:16, cursor:"pointer" },
  drinkBtnActive: { background:"#2a2000", border:"1px solid #f5a623" },
  postBtn: { background:"#f5a623", color:"#111", border:"none", borderRadius:8, padding:"8px 16px", fontWeight:800, cursor:"pointer", fontFamily:"Georgia,serif" },
  postCard: { background:"#171717", border:"1px solid #242424", borderRadius:14, padding:14, marginBottom:12 },
  postAvatar: { fontSize:26, background:"#1e1e1e", border:"1px solid #2a2a2a", borderRadius:"50%", width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0 },
  likeBtn: { background:"#1e1e1e", border:"1px solid #2a2a2a", borderRadius:8, padding:"6px 12px", color:"#ccc", cursor:"pointer", fontSize:13, fontFamily:"Georgia,serif" },
  geoBtn: { background:"#1e1e1e", border:"1px solid #f5a623", color:"#f5a623", borderRadius:10, padding:"10px 16px", cursor:"pointer", fontFamily:"Georgia,serif", fontSize:14 },
  emptyState: { textAlign:"center", color:"#666", fontSize:16, lineHeight:1.8, marginTop:60, fontStyle:"italic" },
  nearbyCard: { background:"#171717", border:"1px solid #242424", borderRadius:14, padding:14, marginBottom:12, display:"flex", alignItems:"center", gap:12 },
  btnSmall: { background:"#1e1e1e", border:"1px solid #2a2a2a", color:"#e8e0d0", borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:12, fontFamily:"Georgia,serif", whiteSpace:"nowrap" },
  nav: { position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"rgba(10,10,10,0.97)", backdropFilter:"blur(10px)", borderTop:"1px solid #1e1e1e", display:"flex", zIndex:100 },
  navBtn: { flex:1, background:"none", border:"none", color:"#666", cursor:"pointer", padding:"10px 0 8px", display:"flex", flexDirection:"column", alignItems:"center", gap:3, fontFamily:"Georgia,serif" },
  navBtnActive: { color:"#f5a623" },
  modal: { position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center", backdropFilter:"blur(4px)" },
  modalBox: { background:"#141414", borderRadius:"20px 20px 0 0", width:"100%", maxWidth:480, maxHeight:"85vh", overflowY:"auto", padding:20, position:"relative", borderTop:"1px solid #2a2a2a" },
  modalClose: { position:"absolute", top:16, right:16, background:"#2a2a2a", border:"none", color:"#ccc", width:32, height:32, borderRadius:"50%", cursor:"pointer", fontSize:14 },
  toast: { position:"fixed", top:70, left:"50%", transform:"translateX(-50%)", background:"#f5a623", color:"#111", padding:"10px 20px", borderRadius:30, fontWeight:700, fontSize:14, zIndex:300, whiteSpace:"nowrap", boxShadow:"0 4px 20px rgba(245,166,35,0.4)" },
};
