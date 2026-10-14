import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, AppState, Image, KeyboardAvoidingView, Platform, Pressable,
  SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as Crypto from 'expo-crypto'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './src/lib/supabase'
import { photoUrl, uploadPhoto, type LocalPhoto } from './src/lib/media'
import { subjects, type Question, type SolvedQuestion, type Subject } from './src/lib/academic'

type Profile = { role: 'student' | 'teacher'; must_change_password: boolean }
type Screen = 'home' | 'ask' | 'my' | 'library' | 'inbox' | 'detail'
const ink = '#18242d'
const muted = '#71808b'
const blue = '#246bfe'
const pale = '#f4f6f8'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(true)
  const [screen, setScreen] = useState<Screen>('home')
  const [previousScreen, setPreviousScreen] = useState<Screen>('home')
  const [questions, setQuestions] = useState<Question[]>([])
  const [solved, setSolved] = useState<SolvedQuestion[]>([])
  const [selected, setSelected] = useState<Question | SolvedQuestion | null>(null)
  const [roleChoice, setRoleChoice] = useState<'student' | 'teacher'>('student')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [subject, setSubject] = useState<Subject>('Math')
  const [questionText, setQuestionText] = useState('')
  const [answerText, setAnswerText] = useState('')
  const [questionPhoto, setQuestionPhoto] = useState<LocalPhoto | null>(null)
  const [answerPhoto, setAnswerPhoto] = useState<LocalPhoto | null>(null)
  const [working, setWorking] = useState(false)
  const [filter, setFilter] = useState<Subject>('Math')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session)).finally(() => setBusy(false))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh()
      else supabase.auth.stopAutoRefresh()
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    void loadProfile()
  }, [session?.user.id])

  useEffect(() => {
    if (!session || !profile || profile.must_change_password) return
    void refreshQuestions()
  }, [session?.user.id, profile?.role, profile?.must_change_password, screen])

  async function loadProfile() {
    if (!session) return
    const { data, error } = await supabase.from('profiles').select('role,must_change_password').eq('id', session.user.id).maybeSingle()
    if (error) { Alert.alert('Account setup needed', 'Your school account has no app profile yet. Ask the school administrator to assign your role.'); return }
    if (!data?.role) { Alert.alert('Account setup needed', 'Your account has not been assigned a student or teacher role.'); return }
    setProfile(data as Profile)
  }

  async function refreshQuestions() {
    if (!session || !profile) return
    if (profile.role === 'student') {
      const [{ data: own, error: ownError }, { data: library, error: libraryError }] = await Promise.all([
        supabase.from('questions').select('*').eq('student_id', session.user.id).order('created_at', { ascending: false }),
        supabase.from('solved_questions').select('*').order('solved_at', { ascending: false }),
      ])
      if (ownError || libraryError) { Alert.alert('Could not load questions', ownError?.message ?? libraryError?.message); return }
      setQuestions((own ?? []) as Question[]); setSolved((library ?? []) as SolvedQuestion[])
    } else {
      const { data, error } = await supabase.from('questions').select('*').order('created_at', { ascending: false })
      if (error) { Alert.alert('Could not load inbox', error.message); return }
      setQuestions((data ?? []) as Question[])
    }
  }

  async function signIn() {
    if (!isSupabaseConfigured) return Alert.alert('Setup required', 'Add your Supabase URL and publishable key in a local .env file.')
    setWorking(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setWorking(false)
    if (error) return Alert.alert('Sign in failed', error.message)
    const { data: p } = await supabase.from('profiles').select('role,must_change_password').eq('id', data.user.id).maybeSingle()
    if (p?.role && p.role !== roleChoice) {
      await supabase.auth.signOut()
      return Alert.alert('Choose the right sign-in type', `This account is registered as a ${p.role}.`)
    }
    if (p) setProfile(p as Profile)
  }

  async function changePassword() {
    if (nextPassword.length < 10) return Alert.alert('Choose a stronger password', 'Use at least 10 characters.')
    setWorking(true)
    const { error } = await supabase.auth.updateUser({ password: nextPassword })
    setWorking(false)
    if (error) return Alert.alert('Password not changed', error.message)
    setPassword(''); setNextPassword('')
    await loadProfile()
  }

  async function choosePhoto(setter: (p: LocalPhoto | null) => void) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) return Alert.alert('Photo access needed', 'Allow access to your library to attach a photo.')
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 })
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0]
      setter({ uri: asset.uri, name: asset.fileName ?? `photo.${asset.mimeType?.split('/')[1] ?? 'jpg'}`, mimeType: asset.mimeType ?? 'image/jpeg' })
    }
  }

  async function submitQuestion() {
    if (!questionText.trim()) return Alert.alert('Add your question', 'Write a short description before submitting.')
    if (!session) return
    setWorking(true)
    const id = Crypto.randomUUID()
    try {
      const { error } = await supabase.from('questions').insert({ id, student_id: session.user.id, subject, question_text: questionText.trim() })
      if (error) throw error
      if (questionPhoto) {
        try {
          const photoPath = await uploadPhoto(questionPhoto, id, 'question')
          const { error: photoError } = await supabase.from('questions').update({ question_photo_path: photoPath }).eq('id', id)
          if (photoError) throw photoError
        } catch (photoError) {
          setQuestionText(''); setQuestionPhoto(null); setScreen('my'); await refreshQuestions()
          return Alert.alert('Question sent', 'Your question was saved, but its photo could not be attached. Your teacher can still reply to the question text.')
        }
      }
      setQuestionText(''); setQuestionPhoto(null); setScreen('my')
      await refreshQuestions()
    } catch (e) { Alert.alert('Could not submit', e instanceof Error ? e.message : 'Please try again.') }
    finally { setWorking(false) }
  }

  async function submitAnswer() {
    if (!selected || !answerText.trim()) return Alert.alert('Write a reply', 'Add an explanation before sending.')
    setWorking(true)
    try {
      const path = answerPhoto ? await uploadPhoto(answerPhoto, selected.id, 'answer') : null
      const { error } = await supabase.from('questions').update({ answer_text: answerText.trim(), answer_photo_path: path }).eq('id', selected.id)
      if (error) throw error
      setAnswerText(''); setAnswerPhoto(null); setScreen('inbox')
      await refreshQuestions()
    } catch (e) { Alert.alert('Could not send reply', e instanceof Error ? e.message : 'Please try again.') }
    finally { setWorking(false) }
  }

  async function signOut() { await supabase.auth.signOut(); setProfile(null); setScreen('home') }

  if (busy) return <Centered><ActivityIndicator color={blue} /></Centered>
  if (!session) return <SignIn email={email} setEmail={setEmail} password={password} setPassword={setPassword} role={roleChoice} setRole={setRoleChoice} onSubmit={signIn} working={working} />
  if (!profile) return <Centered><ActivityIndicator color={blue} /><Text style={styles.note}>Loading your school account…</Text><Action title="Sign out" onPress={signOut} secondary /></Centered>
  if (profile.must_change_password) return <PasswordScreen value={nextPassword} setValue={setNextPassword} onSubmit={changePassword} working={working} onSignOut={signOut} />

  const openQuestion = (item: Question | SolvedQuestion) => { setPreviousScreen(screen); setSelected(item); setAnswerText(''); setAnswerPhoto(null); setScreen('detail') }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.topbar}><View><Text style={styles.eyebrow}>STUDY SUPPORT</Text><Text style={styles.brand}>Hello, {profile.role === 'student' ? 'Student' : 'Teacher'}</Text></View><Pressable onPress={signOut} style={styles.avatar}><Text style={styles.avatarText}>↗</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {profile.role === 'student' ? <>
          {screen === 'home' && <StudentHome total={questions.length} waiting={questions.filter(q => !q.answered_at).length} onAsk={() => setScreen('ask')} onMine={() => setScreen('my')} onLibrary={() => setScreen('library')} />}
          {screen === 'ask' && <AskForm subject={subject} setSubject={setSubject} text={questionText} setText={setQuestionText} photo={questionPhoto} onPhoto={() => choosePhoto(setQuestionPhoto)} onSubmit={submitQuestion} working={working} onBack={() => setScreen('home')} />}
          {screen === 'my' && <QuestionList title="My questions" items={questions} onOpen={openQuestion} empty="Your questions will appear here." />}
          {screen === 'library' && <Library items={solved} filter={filter} setFilter={setFilter} onOpen={openQuestion} />}
          {screen === 'detail' && selected && <Detail item={selected} role="student" onBack={() => setScreen(previousScreen)} />}
        </> : <>
          {screen === 'home' && <TeacherHome total={questions.length} waiting={questions.filter(q => !q.answered_at).length} onInbox={() => setScreen('inbox')} />}
          {screen === 'inbox' && <QuestionList title="Question inbox" items={questions} onOpen={openQuestion} empty="New student questions will appear here." />}
          {screen === 'detail' && selected && <><Detail item={selected} role="teacher" onBack={() => setScreen(previousScreen)} />{'answered_at' in selected && !selected.answered_at && <TeacherReply text={answerText} setText={setAnswerText} photo={answerPhoto} onPhoto={() => choosePhoto(setAnswerPhoto)} onSubmit={submitAnswer} working={working} />}</>}
        </>}
      </ScrollView>
      {screen !== 'detail' && <Nav active={screen} role={profile.role} setScreen={setScreen} />}
    </SafeAreaView>
  )
}

function Centered({ children }: { children: React.ReactNode }) { return <SafeAreaView style={[styles.safe, styles.center]}>{children}</SafeAreaView> }
function SignIn(p: { email: string; setEmail: (v: string) => void; password: string; setPassword: (v: string) => void; role: 'student'|'teacher'; setRole: (v: 'student'|'teacher') => void; onSubmit: () => void; working: boolean }) {
  return <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.signIn} keyboardShouldPersistTaps="handled"><View style={styles.logo}><Text style={styles.logoText}>✳</Text></View><Text style={styles.eyebrow}>YOUR LEARNING SPACE</Text><Text style={styles.title}>A little help goes a long way.</Text><Text style={styles.subtitle}>Sign in with the school email and temporary password provided to you.</Text><View style={styles.segment}>{(['student','teacher'] as const).map(r => <Pressable key={r} onPress={() => p.setRole(r)} style={[styles.segmentItem, p.role === r && styles.segmentSelected]}><Text style={[styles.segmentText, p.role === r && styles.segmentTextSelected]}>{r === 'student' ? 'Student' : 'Teacher'}</Text></Pressable>)}</View><Label>Email address</Label><TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" value={p.email} onChangeText={p.setEmail} placeholder="you@school.edu" placeholderTextColor="#a0aab0" /><Label>Password</Label><TextInput style={styles.input} value={p.password} onChangeText={p.setPassword} secureTextEntry placeholder="Enter your password" placeholderTextColor="#a0aab0" /><Action title="Sign in" onPress={p.onSubmit} working={p.working} /><Text style={styles.signinFoot}>Accounts are created by your school administrator.</Text></ScrollView></KeyboardAvoidingView>
}
function PasswordScreen(p: { value: string; setValue: (v: string) => void; onSubmit: () => void; working: boolean; onSignOut: () => void }) { return <View style={styles.passwordWrap}><Text style={styles.eyebrow}>ONE LAST STEP</Text><Text style={styles.title}>Make this account yours.</Text><Text style={styles.subtitle}>Choose a new password before opening your learning space.</Text><Label>New password</Label><TextInput style={styles.input} value={p.value} onChangeText={p.setValue} secureTextEntry placeholder="At least 10 characters" /><Action title="Update password" onPress={p.onSubmit} working={p.working} /><Action title="Sign out" secondary onPress={p.onSignOut} /></View> }
function StudentHome(p: { total: number; waiting: number; onAsk: () => void; onMine: () => void; onLibrary: () => void }) { return <><View style={styles.hero}><Text style={styles.heroKicker}>A QUESTION IS A GREAT START</Text><Text style={styles.heroTitle}>Curious about something?</Text><Text style={styles.heroCopy}>Send it to your teachers. We’ll work it out together.</Text><Action title="＋  Ask a question" onPress={p.onAsk} /></View><View style={styles.statsRow}><Stat value={`${p.waiting}`} label="Waiting for help" /><Stat value={`${p.total}`} label="My questions" /></View><Text style={styles.sectionTitle}>Keep learning</Text><Tile title="My questions" subtitle="Follow replies from your teachers" icon="✎" onPress={p.onMine} /><Tile title="Solved questions" subtitle="Browse answers by subject" icon="◈" onPress={p.onLibrary} /></> }
function TeacherHome(p: { total: number; waiting: number; onInbox: () => void }) { return <><View style={[styles.hero, styles.teacherHero]}><Text style={styles.heroKicker}>TEACHER WORKSPACE</Text><Text style={styles.heroTitle}>Every question is a chance to help.</Text><Text style={styles.heroCopy}>Review questions and share clear, useful explanations.</Text><Action title="Open question inbox" onPress={p.onInbox} /></View><View style={styles.statsRow}><Stat value={`${p.waiting}`} label="Need a reply" /><Stat value={`${p.total}`} label="Total questions" /></View><Text style={styles.sectionTitle}>Answering a question</Text><Text style={styles.bodyCopy}>Open any waiting question, add an explanation, and optionally attach a photo. Sending a reply marks it answered and adds it to the subject library.</Text></> }
function AskForm(p: { subject: Subject; setSubject: (s: Subject) => void; text: string; setText: (s: string) => void; photo: LocalPhoto | null; onPhoto: () => void; onSubmit: () => void; working: boolean; onBack: () => void }) { return <><Header eyebrow="ASK A TEACHER" title="What are you working on?" subtitle="Choose a subject and tell us where you got stuck." onBack={p.onBack} /><Text style={styles.label}>SUBJECT</Text><SubjectPicker value={p.subject} onChange={p.setSubject} /><Text style={styles.label}>YOUR QUESTION</Text><TextInput style={[styles.input, styles.multiline]} multiline textAlignVertical="top" value={p.text} onChangeText={p.setText} placeholder="Share the question and what you’ve tried so far…" placeholderTextColor="#a0aab0" /><PhotoPicker photo={p.photo} onPress={p.onPhoto} label="Add a photo" /><Action title="Send question" onPress={p.onSubmit} working={p.working} /><Text style={styles.caption}>Your teacher can see your question and photo. Your name is hidden if it becomes a solved example.</Text></> }
function TeacherReply(p: { text: string; setText: (s: string) => void; photo: LocalPhoto | null; onPhoto: () => void; onSubmit: () => void; working: boolean }) { return <View style={styles.replyBox}><Text style={styles.sectionTitle}>Write your reply</Text><TextInput style={[styles.input, styles.multiline]} multiline textAlignVertical="top" value={p.text} onChangeText={p.setText} placeholder="Explain the steps clearly…" placeholderTextColor="#a0aab0" /><PhotoPicker photo={p.photo} onPress={p.onPhoto} label="Attach a reply photo" /><Action title="Send reply & mark answered" onPress={p.onSubmit} working={p.working} /></View> }
function QuestionList(p: { title: string; items: Question[]; onOpen: (q: Question) => void; empty: string }) { return <><Header eyebrow="YOUR LEARNING SPACE" title={p.title} subtitle="Open a question to read the full thread." />{p.items.length === 0 ? <Empty title="Nothing here yet" copy={p.empty} /> : p.items.map(q => <QuestionCard key={q.id} item={q} onPress={() => p.onOpen(q)} />)}</> }
function Library(p: { items: SolvedQuestion[]; filter: Subject; setFilter: (s: Subject) => void; onOpen: (q: SolvedQuestion) => void }) { const results = useMemo(() => p.items.filter(q => q.subject === p.filter), [p.items,p.filter]); return <><Header eyebrow="SHARED LIBRARY" title="Learn from solved questions." subtitle="Real questions, helpful explanations, organized by subject." /><SubjectPicker value={p.filter} onChange={p.setFilter} />{results.length ? results.map(q => <QuestionCard key={q.id} item={q} onPress={() => p.onOpen(q)} />) : <Empty title={`No ${p.filter.toLowerCase()} answers yet`} copy="Solved questions will show up here as teachers reply." />}</> }
function Detail(p: { item: Question | SolvedQuestion; role: 'student'|'teacher'; onBack: () => void }) { const [qUrl,setQUrl] = useState<string|null>(null); const [aUrl,setAUrl] = useState<string|null>(null); useEffect(() => { let alive=true; Promise.all([photoUrl(p.item.question_photo_path), photoUrl(p.item.answer_photo_path)]).then(([q,a]) => {if(alive){setQUrl(q);setAUrl(a)}}); return () => {alive=false} },[p.item.id]); return <><Header eyebrow={p.item.subject.toUpperCase()} title={p.item.question_text} subtitle={`${'solved_at' in p.item ? 'Solved example' : `Asked ${new Date(p.item.created_at).toLocaleDateString()}`}`} onBack={p.onBack} />{qUrl && <Image source={{uri:qUrl}} style={styles.photoPreview} resizeMode="cover" />}<View style={styles.answerStatus}><View style={[styles.dot, p.item.answer_text && styles.dotGreen]} /><Text style={styles.statusText}>{p.item.answer_text ? 'Answered' : 'Waiting for a teacher'}</Text></View>{p.item.answer_text && <View style={styles.answerCard}><Text style={styles.answerLabel}>TEACHER REPLY</Text><Text style={styles.answerText}>{p.item.answer_text}</Text>{aUrl && <Image source={{uri:aUrl}} style={styles.photoPreview} resizeMode="cover" />}</View>}</> }
function QuestionCard(p: { item: Question | SolvedQuestion; onPress: () => void }) { const done = Boolean(p.item.answer_text); return <Pressable onPress={p.onPress} style={styles.questionCard}><View style={styles.cardTop}><Text style={styles.subjectTag}>{p.item.subject}</Text><Text style={[styles.cardStatus, done && styles.cardStatusDone]}>{done ? 'Answered' : 'Waiting'}</Text></View><Text style={styles.cardQuestion} numberOfLines={2}>{p.item.question_text}</Text><Text style={styles.cardFoot}>{new Date(p.item.created_at).toLocaleDateString()}  ·  Open details  ›</Text></Pressable> }
function SubjectPicker(p: { value: Subject; onChange: (s: Subject) => void }) { return <View style={styles.subjectGrid}>{subjects.map(s => <Pressable key={s} onPress={() => p.onChange(s)} style={[styles.subjectButton,p.value===s&&styles.subjectActive]}><Text style={[styles.subjectText,p.value===s&&styles.subjectTextActive]}>{s}</Text></Pressable>)}</View> }
function PhotoPicker(p: { photo: LocalPhoto | null; onPress: () => void; label: string }) { return <Pressable onPress={p.onPress} style={styles.photoPick}><Text style={styles.photoIcon}>▧</Text><View style={{flex:1}}><Text style={styles.photoTitle}>{p.photo?.name ?? p.label}</Text><Text style={styles.photoHint}>{p.photo ? 'Tap to choose a different photo' : 'Optional · add a clear picture'}</Text></View><Text style={styles.photoAdd}>{p.photo ? 'Change' : '＋'}</Text></Pressable> }
function Nav(p: { active: Screen; role: 'student'|'teacher'; setScreen: (s: Screen) => void }) { const items: [Screen,string,string][] = p.role==='student' ? [['home','⌂','Home'],['my','▤','My questions'],['library','◈','Solved']] : [['home','⌂','Home'],['inbox','▤','Inbox']]; return <View style={styles.nav}>{items.map(([id,icon,label]) => <Pressable key={id} onPress={() => p.setScreen(id)} style={styles.navItem}><Text style={[styles.navIcon,p.active===id&&styles.navActive]}>{icon}</Text><Text style={[styles.navLabel,p.active===id&&styles.navActive]}>{label}</Text></Pressable>)}</View> }
function Header(p: { eyebrow: string; title: string; subtitle: string; onBack?: () => void }) { return <View style={styles.header}>{p.onBack && <Pressable onPress={p.onBack} style={styles.back}><Text style={styles.backText}>‹  Back</Text></Pressable>}<Text style={styles.eyebrow}>{p.eyebrow}</Text><Text style={styles.pageTitle}>{p.title}</Text><Text style={styles.subtitle}>{p.subtitle}</Text></View> }
function Label(p: { children: React.ReactNode }) { return <Text style={styles.label}>{p.children}</Text> }
function Action(p: { title: string; onPress: () => void; secondary?: boolean; working?: boolean }) { return <Pressable disabled={p.working} onPress={p.onPress} style={[styles.action,p.secondary&&styles.actionSecondary]}>{p.working?<ActivityIndicator color={p.secondary?ink:'white'} />:<Text style={[styles.actionText,p.secondary&&styles.actionTextSecondary]}>{p.title}</Text>}</Pressable> }
function Tile(p: { title: string; subtitle: string; icon: string; onPress: () => void }) { return <Pressable onPress={p.onPress} style={styles.tile}><View style={styles.tileIcon}><Text style={styles.tileIconText}>{p.icon}</Text></View><View style={{flex:1}}><Text style={styles.tileTitle}>{p.title}</Text><Text style={styles.tileSubtitle}>{p.subtitle}</Text></View><Text style={styles.chevron}>›</Text></Pressable> }
function Stat(p: { value: string; label: string }) { return <View style={styles.stat}><Text style={styles.statValue}>{p.value}</Text><Text style={styles.statLabel}>{p.label}</Text></View> }
function Empty(p: { title: string; copy: string }) { return <View style={styles.empty}><Text style={styles.emptyIcon}>✳</Text><Text style={styles.emptyTitle}>{p.title}</Text><Text style={styles.emptyCopy}>{p.copy}</Text></View> }

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#fff'},center:{justifyContent:'center',alignItems:'center',padding:24},content:{paddingHorizontal:22,paddingBottom:120},topbar:{paddingHorizontal:22,paddingTop:10,paddingBottom:18,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},eyebrow:{fontSize:10,fontWeight:'800',letterSpacing:1.5,color:blue,marginBottom:7},brand:{fontSize:22,fontWeight:'800',color:ink},avatar:{width:40,height:40,borderRadius:20,backgroundColor:pale,alignItems:'center',justifyContent:'center'},avatarText:{fontSize:19,color:ink},
  signIn:{flexGrow:1,justifyContent:'center',padding:26,paddingTop:50},logo:{width:58,height:58,borderRadius:18,backgroundColor:'#e9efff',alignItems:'center',justifyContent:'center',marginBottom:30},logoText:{fontSize:31,color:blue},title:{fontSize:32,lineHeight:38,fontWeight:'800',color:ink,letterSpacing:-.5,marginBottom:12},subtitle:{fontSize:15,lineHeight:22,color:muted,marginBottom:25},note:{fontSize:13,color:muted,marginTop:12},segment:{flexDirection:'row',padding:4,backgroundColor:pale,borderRadius:13,marginBottom:24},segmentItem:{flex:1,padding:12,alignItems:'center',borderRadius:10},segmentSelected:{backgroundColor:'#fff',elevation:1},segmentText:{fontWeight:'700',color:muted},segmentTextSelected:{color:ink},label:{fontSize:11,fontWeight:'800',letterSpacing:1,color:ink,marginBottom:9,marginTop:13},input:{borderWidth:1,borderColor:'#e2e7eb',borderRadius:13,paddingHorizontal:15,paddingVertical:14,fontSize:15,color:ink,marginBottom:8,backgroundColor:'#fff'},multiline:{minHeight:145,paddingTop:15},action:{backgroundColor:blue,borderRadius:14,paddingVertical:16,paddingHorizontal:18,alignItems:'center',justifyContent:'center',marginTop:16,minHeight:54},actionSecondary:{backgroundColor:pale},actionText:{color:'white',fontSize:15,fontWeight:'800'},actionTextSecondary:{color:ink},signinFoot:{textAlign:'center',fontSize:12,color:muted,marginTop:19},passwordWrap:{flex:1,justifyContent:'center',padding:26},back:{marginBottom:14,alignSelf:'flex-start'},backText:{fontSize:14,color:blue,fontWeight:'800'},
  hero:{backgroundColor:'#edf2ff',borderRadius:24,padding:23,paddingTop:25,marginTop:8,marginBottom:18},teacherHero:{backgroundColor:'#eaf6f1'},heroKicker:{fontSize:10,fontWeight:'800',letterSpacing:1.3,color:blue,marginBottom:14},heroTitle:{fontSize:27,lineHeight:32,fontWeight:'800',color:ink,letterSpacing:-.4,maxWidth:300},heroCopy:{fontSize:14,lineHeight:21,color:muted,marginTop:9,marginBottom:6},statsRow:{flexDirection:'row',gap:12,marginBottom:28},stat:{flex:1,backgroundColor:pale,borderRadius:18,padding:17},statValue:{fontSize:25,fontWeight:'800',color:ink,marginBottom:4},statLabel:{fontSize:12,color:muted},sectionTitle:{fontSize:18,fontWeight:'800',color:ink,marginTop:12,marginBottom:13},tile:{flexDirection:'row',alignItems:'center',padding:16,borderWidth:1,borderColor:'#edf0f2',borderRadius:17,marginBottom:11},tileIcon:{width:42,height:42,borderRadius:13,backgroundColor:'#edf2ff',alignItems:'center',justifyContent:'center',marginRight:13},tileIconText:{fontSize:20,color:blue},tileTitle:{fontSize:15,fontWeight:'800',color:ink},tileSubtitle:{fontSize:12,color:muted,marginTop:4},chevron:{fontSize:27,color:muted,marginLeft:8},header:{paddingTop:12,paddingBottom:15},pageTitle:{fontSize:27,lineHeight:33,fontWeight:'800',color:ink,letterSpacing:-.5,marginBottom:8},bodyCopy:{fontSize:14,lineHeight:22,color:muted,marginBottom:20},
  subjectGrid:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:16},subjectButton:{borderRadius:20,borderWidth:1,borderColor:'#e2e7eb',paddingHorizontal:14,paddingVertical:9,backgroundColor:'#fff'},subjectActive:{borderColor:blue,backgroundColor:'#edf2ff'},subjectText:{fontSize:13,fontWeight:'700',color:muted},subjectTextActive:{color:blue},photoPick:{flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:'#e2e7eb',borderStyle:'dashed',borderRadius:14,padding:14,marginTop:12},photoIcon:{fontSize:22,color:blue,marginRight:12},photoTitle:{fontSize:13,fontWeight:'700',color:ink},photoHint:{fontSize:11,color:muted,marginTop:3},photoAdd:{color:blue,fontWeight:'800'},caption:{fontSize:11,lineHeight:16,color:muted,marginTop:12},
  questionCard:{borderWidth:1,borderColor:'#edf0f2',borderRadius:17,padding:16,marginBottom:12},cardTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:13},subjectTag:{backgroundColor:'#edf2ff',color:blue,overflow:'hidden',paddingHorizontal:10,paddingVertical:5,borderRadius:20,fontSize:11,fontWeight:'800'},cardStatus:{fontSize:11,color:'#b36a14',fontWeight:'800'},cardStatusDone:{color:'#25835b'},cardQuestion:{fontSize:16,lineHeight:22,fontWeight:'700',color:ink,marginBottom:12},cardFoot:{fontSize:11,color:muted},empty:{alignItems:'center',padding:30,backgroundColor:pale,borderRadius:20,marginTop:10},emptyIcon:{fontSize:25,color:blue,marginBottom:12},emptyTitle:{fontSize:16,fontWeight:'800',color:ink},emptyCopy:{fontSize:13,lineHeight:19,textAlign:'center',color:muted,marginTop:5},
  answerStatus:{flexDirection:'row',alignItems:'center',marginVertical:12},dot:{width:9,height:9,borderRadius:5,backgroundColor:'#e3a244',marginRight:8},dotGreen:{backgroundColor:'#279b69'},statusText:{fontSize:12,fontWeight:'700',color:muted},answerCard:{backgroundColor:'#f1f7f3',padding:17,borderRadius:18,marginTop:5},answerLabel:{fontSize:10,fontWeight:'800',letterSpacing:1.2,color:'#25835b',marginBottom:10},answerText:{fontSize:15,lineHeight:23,color:ink},photoPreview:{width:'100%',height:220,borderRadius:16,marginTop:12,backgroundColor:pale},replyBox:{marginTop:22,paddingTop:16,borderTopWidth:1,borderColor:'#edf0f2'},nav:{position:'absolute',bottom:0,left:0,right:0,backgroundColor:'#ffffff',borderTopWidth:1,borderTopColor:'#edf0f2',paddingTop:10,paddingBottom:13,flexDirection:'row',justifyContent:'space-around'},navItem:{alignItems:'center',minWidth:80},navIcon:{fontSize:21,color:'#9aa4aa'},navLabel:{fontSize:10,color:'#9aa4aa',marginTop:3,fontWeight:'700'},navActive:{color:blue},
})
