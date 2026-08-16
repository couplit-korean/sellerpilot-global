"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 10 || password !== confirm) {
      setMessage("10자 이상의 동일한 비밀번호를 두 번 입력해 주세요.");
      return;
    }
    setLoading(true);
    const { error } = await createClient().auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setMessage("비밀번호를 변경하지 못했습니다. 링크를 다시 요청해 주세요.");
      return;
    }
    setMessage("비밀번호가 변경되었습니다. 잠시 후 로그인 화면으로 이동합니다.");
    window.setTimeout(() => router.push("/"), 1400);
  };

  return (
    <main className="password-page">
      <form className="password-card" onSubmit={submit}>
        <span className="secure-mark"><LockKeyhole size={21} /></span>
        <h1>새 비밀번호 설정</h1>
        <p>SellerPilot 관리자 계정에 사용할 새 비밀번호를 입력하세요.</p>
        <label htmlFor="new-password">새 비밀번호</label>
        <div className="input-wrap"><LockKeyhole size={17} /><input id="new-password" type={visible ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-toggle" onClick={() => setVisible((current) => !current)} aria-label={visible ? "비밀번호 숨기기" : "비밀번호 보기"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
        <label htmlFor="new-password-confirm">비밀번호 확인</label>
        <div className="input-wrap"><CheckCircle2 size={17} /><input id="new-password-confirm" type={visible ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></div>
        {message && <p className="password-message">{message}</p>}
        <button className="login-button" type="submit" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={18} />변경 중...</> : <>비밀번호 저장<ArrowRight size={18} /></>}</button>
      </form>
    </main>
  );
}
