# 音声翻訳アプリ 要件定義書

## 1. 目的

マイクで入力した音声を、別の言語の音声およびテキストとして
出力する技術調査用アプリを開発する。

本アプリは、Google Cloudの音声認識、翻訳、音声合成を使い、
実用的な逐次通訳に近い体験を実現できるかを確認するための
ものである。

将来的には観光タクシー等での会話支援への応用を検討するが、
本要件では特定業務に依存しない汎用的な技術調査アプリとする。

## 2. 基本方針

完全な同時通訳は目指さない。

ユーザーが短く話し、少し待つと、別の言語の音声が再生される
体験を目標とする。

つまり、本アプリの基本UXは以下である。

```text
話す
  ↓
少し待つ
  ↓
翻訳テキストが表示される
  ↓
翻訳音声が再生される
```

ストリーミング音声認識は使用するが、翻訳と音声合成は、
原則として確定した発話区切り単位で実行する。

## 3. 調査対象

今回の調査対象は以下である。

* ブラウザのマイク音声を取得する
* 音声を短いチャンクでサーバーへ送信する
* Cloud Speech-to-Textでストリーミング音声認識する
* 認識途中結果を画面に表示する
* 確定した発話区切りを翻訳する
* 翻訳結果を画面に表示する
* 翻訳結果を音声合成する
* 合成音声をブラウザで再生する
* 発話区切りの調整による使い勝手を確認する

## 4. 開発方針

技術調査を目的とするため、不要な仕組みは極力排除する。

重視することは以下。

* ローカル環境で動作する
* デプロイしない
* DBを使わない
* ユーザー認証を作らない
* 会話履歴を永続保存しない
* UIは最低限にする
* 本番運用の作り込みはしない
* GCPサービスは最小限にする
* 低遅延化よりも、自然に意味が通る翻訳を優先する

## 5. 使用するGCPサービス

使用するGCPサービスは以下の3つとする。

* Cloud Speech-to-Text
* Cloud Translation
* Cloud Text-to-Speech

MVPでは、Cloud Media Translation APIは使用しない。

理由は、本調査ではまず以下の構成を理解しやすく検証したい
ためである。

```text
Speech-to-Text
  ↓
Translation
  ↓
Text-to-Speech
```

## 6. MVPのゴール

MVPでは以下を実現する。

* ブラウザでマイク入力できる
* 音声をサーバーへ逐次送信できる
* Speech-to-Textの途中認識結果を表示できる
* Speech-to-Textの確定結果を取得できる
* 確定結果をCloud Translationで翻訳できる
* 翻訳結果をCloud Text-to-Speechで音声化できる
* ブラウザで合成音声を再生できる
* 日本語から英語へ翻訳できる
* 英語から日本語へ翻訳できる
* 発話区切りの挙動を調整・確認できる

## 7. 対象外

以下はMVPの対象外とする。

* デプロイ
* Cloud Run
* Docker
* DB
* ユーザー認証
* 会話履歴の永続保存
* 複数ユーザー対応
* 話者識別
* 言語自動判定
* 管理画面
* 本番用ログ基盤
* 課金管理
* 観光タクシー専用UI
* 完全な同時通訳
* Media Translation APIの本格検証
* ストリーミングText-to-Speechの本格検証

## 8. システム構成

## 8.1 全体構成

Next.jsアプリと、ローカルNode.js WebSocketサーバーを
同一リポジトリで起動する。

```text
Browser
  ↓
Next.js Page
  ↓ WebSocket
Local Node.js WebSocket Server
  ↓
Google Cloud Speech-to-Text
  ↓
Google Cloud Translation
  ↓
Google Cloud Text-to-Speech
  ↓
Local Node.js WebSocket Server
  ↓ WebSocket
Browser
```

## 8.2 Next.jsの役割

Next.jsは画面表示とクライアント処理を担当する。

* マイク入力
* 音声チャンク生成
* WebSocket接続
* サーバーへの音声送信
* 認識途中結果の表示
* 認識確定結果の表示
* 翻訳結果の表示
* 合成音声の再生
* 状態表示
* エラー表示
* 発話区切り設定のUI表示

## 8.3 WebSocketサーバーの役割

WebSocketサーバーはGCP APIとの接続を担当する。

* クライアントから音声チャンクを受け取る
* Speech-to-Text Streamingへ音声を送る
* 認識途中結果をクライアントへ返す
* 認識確定結果を管理する
* 発話区切りを判定する
* 確定した発話をTranslationへ渡す
* 翻訳結果をText-to-Speechへ渡す
* 合成音声をクライアントへ返す
* エラーをクライアントへ返す

## 9. 技術スタック

## 9.1 フロントエンド

* Next.js
* React
* TypeScript
* MediaRecorder API
* WebSocket API

## 9.2 サーバー

* Node.js
* TypeScript
* ws
* Google Cloud client libraries

## 9.3 ローカル実行

デプロイは行わない。

ローカルで以下を同時に起動する。

* Next.js dev server
* Node.js WebSocket server

## 10. 基本動作

## 10.1 操作フロー

1. ユーザーが入力言語を選択する
2. ユーザーが出力言語を選択する
3. ユーザーが接続ボタンを押す
4. ユーザーが録音開始ボタンを押す
5. ユーザーが短く話す
6. 音声がサーバーへ逐次送信される
7. 認識途中結果が画面に表示される
8. 発話区切りが確定する
9. 確定した発話が翻訳される
10. 翻訳テキストが画面に表示される
11. 翻訳音声が再生される
12. ユーザーが次の発話を行う

## 10.2 想定する会話テンポ

以下のような逐次通訳に近いテンポを想定する。

```text
話者Aが1文話す
  ↓
1〜3秒程度待つ
  ↓
翻訳音声が流れる
  ↓
話者Bが返答する
  ↓
1〜3秒程度待つ
  ↓
翻訳音声が流れる
```

MVPでは厳密な秒数保証は不要とする。

## 11. 画面要件

画面は1ページのみとする。

## 11.1 表示項目

* 入力言語選択
* 出力言語選択
* 接続ボタン
* 切断ボタン
* 録音開始ボタン
* 録音停止ボタン
* 認識途中テキスト表示欄
* 認識確定テキスト表示欄
* 翻訳テキスト表示欄
* 音声再生ON/OFF
* 発話区切り設定
* 状態表示
* エラー表示
* 簡易レイテンシ表示

## 11.2 対応言語

MVPでは以下のみ対応する。

* 日本語
* 英語

言語ペアは以下。

* 日本語 → 英語
* 英語 → 日本語

## 12. 音声入力仕様

## 12.1 入力方式

ブラウザのマイクから音声を取得する。

MVPではMediaRecorder APIを使用してよい。

## 12.2 音声チャンク

録音中、短い間隔で音声チャンクを生成し、WebSocketで
サーバーへ送信する。

初期値は以下のいずれかとする。

```text
500msごと
```

または

```text
1000msごと
```

チャンク間隔は設定値として変更できるようにする。

## 12.3 音声形式

最初は実装しやすい形式を採用する。

候補は以下。

* WebM / Opus
* Linear PCM
* WAV

Speech-to-Text Streamingに渡しやすい形式を優先する。

ブラウザで取得した形式がそのまま使いづらい場合は、
Linear PCM変換を検討する。

ただし、MVPでは音声形式の変換に過度な実装コストをかけない。

## 13. 発話区切り仕様

## 13.1 基本方針

翻訳と音声合成は、原則として確定した発話区切り単位で行う。

句点がない長い発話でも、一定の条件で区切りを作る。

これにより、翻訳開始が遅れすぎることを防ぐ。

## 13.2 区切り条件

以下の条件を組み合わせて発話区切りを判定する。

* Speech-to-Textのfinal result
* 一定時間の無音
* 一定文字数
* 一定秒数
* ユーザーによる録音停止

## 13.3 初期設定

初期設定は以下とする。

```text
final resultを基本の翻訳対象にする
無音が1.0秒以上続いたら区切り候補とする
確定テキストが80文字を超えたら区切り候補とする
同一発話が10秒を超えたら区切り候補とする
```

数値は実装後に調整できるようにする。

## 13.4 interim resultの扱い

Speech-to-Textのinterim resultは画面表示に使用する。

interim resultは原則として翻訳しない。

理由は、途中認識は後から変化する可能性があり、音声出力に
使うと不自然になるためである。

ただし、技術調査用に、interim resultを仮翻訳するモードを
追加してもよい。

初期状態ではOFFとする。

## 13.5 音声出力の対象

Text-to-Speechは、確定済みの発話区切りだけを対象にする。

未確定のinterim resultや仮翻訳は音声出力しない。

これは、一度読み上げた内容を後から修正できないためである。

## 14. WebSocketメッセージ仕様

## 14.1 接続先

```text
ws://localhost:3001/ws
```

## 14.2 クライアントから送るメッセージ

### セッション開始

```json
{
  "type": "start",
  "sourceLanguage": "ja-JP",
  "targetLanguage": "en-US",
  "enableTts": true,
  "chunkMs": 500,
  "silenceMs": 1000,
  "maxChars": 80,
  "maxSeconds": 10
}
```

### 音声チャンク

```json
{
  "type": "audio",
  "data": "base64 encoded audio chunk"
}
```

### セッション停止

```json
{
  "type": "stop"
}
```

### 手動区切り

```json
{
  "type": "commit"
}
```

## 14.3 サーバーから返すメッセージ

### 認識途中結果

```json
{
  "type": "transcript_interim",
  "text": "今日は雨が降っているので"
}
```

### 認識確定結果

```json
{
  "type": "transcript_final",
  "text": "今日は雨が降っているので"
}
```

### 発話区切り確定

```json
{
  "type": "utterance_committed",
  "text": "今日は雨が降っているので、屋内に行きましょう"
}
```

### 翻訳結果

```json
{
  "type": "translation",
  "sourceText": "今日は雨が降っているので、屋内に行きましょう",
  "translatedText": "Since it is raining today, let's go indoors."
}
```

### 音声合成結果

```json
{
  "type": "audio",
  "mimeType": "audio/mpeg",
  "data": "base64 encoded audio"
}
```

### レイテンシ情報

```json
{
  "type": "metrics",
  "speechMs": 1200,
  "translationMs": 300,
  "ttsMs": 800,
  "totalMs": 2300
}
```

### エラー

```json
{
  "type": "error",
  "message": "Speech-to-Text streaming failed"
}
```

## 15. サーバー側処理仕様

## 15.1 セッション開始

クライアントから`start`メッセージを受け取ったら、
以下を初期化する。

* 入力言語
* 出力言語
* Text-to-Speech有効/無効
* 音声チャンク間隔
* 無音判定時間
* 最大文字数
* 最大発話秒数
* Speech-to-Text Streaming接続
* 発話バッファ

## 15.2 音声認識

受信した音声チャンクをSpeech-to-Text Streamingへ送信する。

Speech-to-Textから受け取った認識結果を以下に分ける。

* interim result
* final result

interim resultはクライアントへ即時返す。

final resultは発話バッファに追加する。

## 15.3 発話バッファ

final resultを発話バッファに蓄積する。

以下のいずれかを満たした場合、発話バッファを確定する。

* 無音が一定時間続いた
* 文字数が上限を超えた
* 発話時間が上限を超えた
* クライアントから`commit`を受け取った
* クライアントから`stop`を受け取った

確定後、発話バッファを空にする。

## 15.4 翻訳

確定した発話テキストをCloud Translationへ送信する。

翻訳結果をクライアントへ返す。

## 15.5 音声合成

`enableTts`がtrueの場合、翻訳結果をText-to-Speechへ送信する。

合成音声をbase64でクライアントへ返す。

MVPではText-to-Speechは通常の同期合成でよい。

## 15.6 エラー処理

エラーが発生した場合、クライアントへエラーメッセージを返す。

可能であればWebSocket接続は維持する。

致命的なエラーの場合のみ接続を終了する。

## 16. レイテンシ計測

技術調査のため、以下を簡易的に計測する。

* 音声チャンク送信開始時刻
* interim result受信時刻
* final result受信時刻
* 発話区切り確定時刻
* 翻訳完了時刻
* TTS完了時刻
* 音声再生開始時刻

画面またはコンソールに所要時間を表示する。

特に以下を分けて確認する。

* 音声認識にかかった時間
* 発話区切り待ち時間
* 翻訳にかかった時間
* 音声合成にかかった時間
* 合計待ち時間

## 17. ローカル開発要件

## 17.1 前提環境

Windows環境で開発できること。

必要なものは以下。

* Node.js LTS
* npm
* Google Cloud CLI
* GCPプロジェクト
* Application Default Credentials

## 17.2 認証

ローカルではApplication Default Credentialsを使用する。

```bash
gcloud auth application-default login
```

GCP認証情報はブラウザ側に置かない。

Google Cloud client librariesは、ローカルWebSocketサーバー側で
のみ使用する。

## 18. 環境変数

必要最小限の環境変数のみ使用する。

```text
GOOGLE_CLOUD_PROJECT=
WS_PORT=3001
DEFAULT_SOURCE_LANGUAGE=ja-JP
DEFAULT_TARGET_LANGUAGE=en-US
ENABLE_TTS=true
ENABLE_INTERIM_TRANSLATION=false
DEFAULT_CHUNK_MS=500
DEFAULT_SILENCE_MS=1000
DEFAULT_MAX_CHARS=80
DEFAULT_MAX_SECONDS=10
```

## 19. ディレクトリ構成

単一リポジトリで構成する。

```text
voice-translator-research/
  src/
    app/
      page.tsx
    components/
      Recorder.tsx
      LanguageSelector.tsx
      TranscriptView.tsx
      SettingsPanel.tsx
    lib/
      audio.ts
      websocketClient.ts
      types.ts
  server/
    index.ts
    speechStream.ts
    translate.ts
    textToSpeech.ts
    utteranceBuffer.ts
    types.ts
  package.json
  README.md
  .env.local.example
```

## 20. npm scripts

以下のスクリプトを用意する。

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:web\" \"npm run dev:ws\"",
    "dev:web": "next dev",
    "dev:ws": "tsx server/index.ts"
  }
}
```

## 21. 実装タスク

## 21.1 初期セットアップ

* Next.jsプロジェクト作成
* TypeScript設定
* 必要パッケージ追加
* README作成
* .env.local.example作成
* concurrently設定
* wsサーバー設定

## 21.2 フロントエンド

* 入力言語選択UI作成
* 出力言語選択UI作成
* 接続ボタン作成
* 切断ボタン作成
* 録音開始ボタン作成
* 録音停止ボタン作成
* 手動区切りボタン作成
* 音声再生ON/OFF作成
* 発話区切り設定UI作成
* WebSocket接続処理作成
* 音声チャンク送信処理作成
* 認識途中結果表示
* 認識確定結果表示
* 翻訳結果表示
* 合成音声再生
* レイテンシ表示
* エラー表示

## 21.3 WebSocketサーバー

* WebSocketサーバー作成
* セッション開始処理
* 音声チャンク受信処理
* Speech-to-Text Streaming接続
* interim result処理
* final result処理
* 発話バッファ処理
* 発話区切り判定
* Translation実行
* Text-to-Speech実行
* クライアントへの結果送信
* エラー送信
* セッション終了処理

## 21.4 GCP連携

* Cloud Speech-to-Text Streaming実装
* Cloud Translation実装
* Cloud Text-to-Speech実装
* GCP認証設定のREADME記載

## 22. 受け入れ条件

以下を満たせばMVP完了とする。

* `npm run dev` でNext.jsとWebSocketサーバーが起動する
* ブラウザでマイク録音できる
* 音声チャンクをWebSocketで送信できる
* Speech-to-Textのinterim resultが表示される
* Speech-to-Textのfinal resultが表示される
* 発話区切りが確定される
* 確定した発話が翻訳される
* 翻訳結果が画面に表示される
* 翻訳結果が音声再生される
* 日本語から英語の翻訳が動作する
* 英語から日本語の翻訳が動作する
* GCP認証情報がクライアント側に含まれていない
* READMEにWindowsでのローカル起動手順が記載されている

## 23. 既知の制限

MVPでは以下の制限を許容する。

* 完全な同時通訳ではない
* 翻訳は確定した発話区切り単位で行う
* 句点がない長い文章は途中で区切る場合がある
* 区切り方によって翻訳品質が変わる
* 音声再生までに数秒の遅延があってよい
* 長時間会話は対象外
* 複数ユーザーは対象外
* デプロイはしない
* UIは最低限でよい
* Text-to-Speechは同期合成でよい

## 24. 今後の拡張候補

技術調査後、必要に応じて以下を検討する。

* 発話区切りロジックの改善
* 無音検知の精度向上
* ストリーミングText-to-Speech
* Cloud Media Translation APIとの比較
* WebRTC化
* Cloud Runデプロイ
* タブレット向けUI
* 観光タクシー向けUI
* 会話履歴
* 多言語対応
* 言語自動判定
* 定型フレーズ機能
* 翻訳前の確認モード

## 25. Claude Codeへの作業指示例

以下の要件定義に従って、技術調査用の音声翻訳アプリを
実装してください。

Next.js + TypeScriptで画面を作成してください。

ストリーミング音声認識を検証するため、Next.jsのRoute
Handlerだけで完結させず、ローカルのNode.js WebSocket
サーバーを同一リポジトリ内に作成してください。

デプロイは不要です。ローカル環境で動作すれば十分です。

使用するGCPサービスは以下の3つに限定してください。

* Cloud Speech-to-Text
* Cloud Translation
* Cloud Text-to-Speech

Cloud Run、Docker、DB、ユーザー認証、会話履歴保存は
実装しないでください。

ブラウザのマイク音声を短いチャンクでWebSocketサーバーへ
送り、サーバー側でCloud Speech-to-Text Streamingへ接続して
ください。

Speech-to-Textのinterim resultは画面表示に使用してください。

翻訳と音声合成は、interim resultではなく、確定した発話区切り
に対して実行してください。

発話区切りは、Speech-to-Textのfinal result、無音時間、
最大文字数、最大秒数、手動区切りボタンを組み合わせて判定
してください。

完全な同時通訳ではなく、ユーザーが短く話して少し待つと
翻訳音声が再生される逐次通訳に近い体験を目指してください。

最初の対象言語は日本語と英語のみで構いません。

READMEには、Windows環境でのローカル起動手順と、
GCP認証設定を記載してください。
