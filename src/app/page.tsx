// Server Component: TranslatorApp（Client Component）を描画するだけ。
// スタイリングは後続タスク（.13）で行う。

import { TranslatorApp } from "../components/TranslatorApp";

export default function Home() {
  return (
    <main>
      <TranslatorApp />
    </main>
  );
}
