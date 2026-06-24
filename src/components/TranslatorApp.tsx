"use client";

/**
 * TranslatorApp コンポーネント
 *
 * アプリケーション最上位の Client Component。
 * useReducer で全体状態を管理し、useWebSocket / useRecorder / useAudioQueue を統合する。
 *
 * このコンポーネントは統合と最小限のプレースホルダ UI に留める。
 * polished な UI は後続タスク（.12 UI / .13 スタイリング）で実装する。
 *
 * プレースホルダ UI の方針:
 * - インライン style の多用は避け、className のみで構造を示す（.13 が CSS Modules を当てる前提）
 * - 色・レイアウトの作り込みは行わない
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { appReducer, initialState, AppActions } from "../lib/appReducer";
import { useWebSocketWithAudio } from "../hooks/useWebSocket";
import { useRecorder } from "../hooks/useRecorder";
import { useAudioQueue } from "../hooks/useAudioQueue";
import type { AppAction, Settings, SupportedLanguage } from "../lib/types";

// ============================================================
// 定数
// ============================================================

const DEFAULT_SETTINGS: Settings = {
  sourceLanguage: "ja-JP",
  targetLanguage: "en-US",
  enableTts: true,
  enableInterimTranslation: false,
  chunkMs: 250,
  silenceMs: 1000,
  maxChars: 80,
  maxSeconds: 10,
};

// ============================================================
// コンポーネント実装
// ============================================================

/**
 * TranslatorApp: 音声翻訳アプリのルートクライアントコンポーネント。
 *
 * 状態遷移:
 * - idle → (開始ボタン) → connecting → (WS onConnected) → connected
 *   → (sendStart + getUserMedia 成功) → recording
 * - recording → (停止ボタン) → sendStop → 録音停止 → WS disconnect → idle
 * - any → (致命的エラー) → error
 */
export function TranslatorApp() {
  // ----------------------------------------------------------
  // 状態管理
  // ----------------------------------------------------------

  const [state, dispatch] = useReducer(appReducer, initialState);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  /**
   * 最新の settings を参照するための ref（useEffect / コールバック内での stale closure 対策）。
   */
  const settingsRef = useRef<Settings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const dispatchTyped: React.Dispatch<AppAction> = dispatch;

  // ----------------------------------------------------------
  // useAudioQueue: 受信音声の FIFO 再生
  // ----------------------------------------------------------

  const audioQueue = useAudioQueue();

  // ----------------------------------------------------------
  // useWebSocket: WebSocket ライフサイクル統合
  // ----------------------------------------------------------

  /**
   * audio メッセージ受信時のコールバック。
   * settingsRef を参照して enableTts の最新値を確認する。
   */
  const handleAudioReceived = useCallback(
    (base64: string) => {
      if (settingsRef.current.enableTts) {
        audioQueue.enqueue(base64);
      }
    },
    [audioQueue],
  );

  const ws = useWebSocketWithAudio(dispatchTyped, {
    onAudioReceived: handleAudioReceived,
  });

  // ----------------------------------------------------------
  // useRecorder: マイク録音管理
  // ----------------------------------------------------------

  const handleChunk = useCallback(
    (base64: string) => {
      ws.sendAudio(base64);
    },
    [ws],
  );

  const handleRecorderError = useCallback((message: string) => {
    dispatch(AppActions.error(message, false));
    // マイク権限エラー等は recording に遷移しないため idle に戻す
    dispatch(AppActions.statusChanged("idle"));
  }, []);

  const recorder = useRecorder({
    onChunk: handleChunk,
    onError: handleRecorderError,
  });

  // ----------------------------------------------------------
  // status "connected" を監視: sendStart → 録音開始 → status "recording"
  // ----------------------------------------------------------

  useEffect(() => {
    if (state.status !== "connected") return;

    const currentSettings = settingsRef.current;

    // サーバーへ start メッセージを送信する
    ws.sendStart(currentSettings);

    // マイク権限取得 → 録音開始
    let cancelled = false;

    recorder.startMicRecording(currentSettings.chunkMs).then((success) => {
      if (cancelled) return;
      if (success) {
        // 録音開始成功 → status: recording へ遷移
        dispatch(AppActions.statusChanged("recording"));
      } else {
        // getUserMedia 失敗（onError で error 状態に遷移済み）
        // WS を切断して idle に戻す
        ws.sendStop();
        ws.disconnect();
      }
    });

    return () => {
      cancelled = true;
    };
    // state.status が "connected" に変わるたびに実行（通常1回のみ）
    // recorder / ws は安定した参照なので依存配列に含めても問題ない
  }, [state.status, ws, recorder]);

  // ----------------------------------------------------------
  // 統合フロー: 開始ボタン押下
  // ----------------------------------------------------------

  const handleStart = useCallback(() => {
    if (state.status !== "idle" && state.status !== "error") return;

    // 前回の transcript / metrics / error をリセット
    dispatch(AppActions.reset());

    // WS 接続を開始する（内部で status: connecting にする）
    // → onConnected で status: connected → 上記 useEffect が発火して sendStart + 録音開始
    ws.connect();
  }, [state.status, ws]);

  // ----------------------------------------------------------
  // 統合フロー: 停止ボタン押下
  // ----------------------------------------------------------

  const handleStop = useCallback(() => {
    if (state.status !== "recording") return;

    // 1. stop メッセージを送る（残バッファを確定させる）
    ws.sendStop();

    // 2. 録音を停止してトラックを解放する
    recorder.stopMicRecording();

    // 3. WS を切断する（onDisconnect コールバックで status: idle になる）
    ws.disconnect();

    // 4. audio キューをリセットする
    audioQueue.reset();
  }, [state.status, ws, recorder, audioQueue]);

  // ----------------------------------------------------------
  // 手動区切り
  // ----------------------------------------------------------

  const handleCommit = useCallback(() => {
    if (state.status !== "recording") return;
    ws.sendCommit();
  }, [state.status, ws]);

  // ----------------------------------------------------------
  // 設定変更
  // ----------------------------------------------------------

  const handleSettingsChange = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleLanguagePairToggle = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      sourceLanguage: prev.targetLanguage,
      targetLanguage: prev.sourceLanguage,
    }));
  }, []);

  // ----------------------------------------------------------
  // UI ヘルパー
  // ----------------------------------------------------------

  const { status } = state;

  const isConnecting = status === "connecting" || status === "connected";
  const isRecording = status === "recording";
  const isDisabled = isConnecting || isRecording;

  const languageLabel = (lang: SupportedLanguage): string =>
    lang === "ja-JP" ? "日本語" : "英語";

  // ----------------------------------------------------------
  // レンダリング
  // ----------------------------------------------------------

  return (
    <div className="translator-app">
      {/* ステータス表示 */}
      <div className="translator-app__status">
        <span>状態: {status}</span>
        {state.error && (
          <span className="translator-app__error">
            {" | "}エラー: {state.error}
          </span>
        )}
      </div>

      {/* 言語ペア表示 */}
      <div className="translator-app__language">
        <span>{languageLabel(settings.sourceLanguage)}</span>
        <button
          type="button"
          onClick={handleLanguagePairToggle}
          disabled={isDisabled}
          className="translator-app__lang-toggle"
          aria-label="言語を入れ替える"
        >
          ⇄
        </button>
        <span>{languageLabel(settings.targetLanguage)}</span>
      </div>

      {/* 操作ボタン */}
      <div className="translator-app__controls">
        {isRecording ? (
          <button
            type="button"
            onClick={handleStop}
            className="translator-app__btn translator-app__btn--stop"
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStart}
            disabled={isConnecting}
            className="translator-app__btn translator-app__btn--start"
          >
            {isConnecting ? "接続中..." : "開始"}
          </button>
        )}

        <button
          type="button"
          onClick={handleCommit}
          disabled={!isRecording}
          className="translator-app__btn"
          aria-label="手動で発話を区切る"
        >
          手動区切り
        </button>
      </div>

      {/* テキスト表示 */}
      <div className="translator-app__transcript">
        {/* 認識途中 */}
        <section className="translator-app__section" aria-label="認識中テキスト">
          <h2 className="translator-app__section-title">認識中</h2>
          <p className="translator-app__interim">
            {state.transcript.interim || "（待機中）"}
          </p>
        </section>

        {/* 認識確定の履歴 */}
        <section className="translator-app__section" aria-label="認識確定テキスト">
          <h2 className="translator-app__section-title">認識確定</h2>
          {state.transcript.finals.length === 0 ? (
            <p>（なし）</p>
          ) : (
            <ul className="translator-app__list">
              {state.transcript.finals.map((text, i) => (
                <li key={i} className="translator-app__list-item">
                  {text}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 翻訳結果の履歴 */}
        <section className="translator-app__section" aria-label="翻訳テキスト">
          <h2 className="translator-app__section-title">翻訳</h2>
          {state.transcript.translations.length === 0 ? (
            <p>（なし）</p>
          ) : (
            <ul className="translator-app__list">
              {state.transcript.translations.map((t, i) => (
                <li key={i} className="translator-app__list-item">
                  <span className="translator-app__source">{t.sourceText}</span>
                  <span className="translator-app__arrow"> → </span>
                  <span className="translator-app__translated">
                    {t.translatedText}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* レイテンシ表示 */}
      {state.metrics && (
        <div className="translator-app__metrics" aria-label="レイテンシ情報">
          <strong>レイテンシ: </strong>
          <span>音声認識 {state.metrics.speechMs}ms</span>
          {" | "}
          <span>翻訳 {state.metrics.translationMs}ms</span>
          {" | "}
          <span>音声合成 {state.metrics.ttsMs}ms</span>
          {" | "}
          <span>合計 {state.metrics.totalMs}ms</span>
        </div>
      )}

      {/* 設定パネル（最小限） */}
      <details className="translator-app__settings">
        <summary>設定</summary>
        <div className="translator-app__settings-body">
          <label className="translator-app__setting-row">
            <span>TTS（音声再生）</span>
            <input
              type="checkbox"
              checked={settings.enableTts}
              onChange={(e) =>
                handleSettingsChange("enableTts", e.target.checked)
              }
              disabled={isDisabled}
            />
          </label>

          <label className="translator-app__setting-row">
            <span>interim 翻訳</span>
            <input
              type="checkbox"
              checked={settings.enableInterimTranslation}
              onChange={(e) =>
                handleSettingsChange(
                  "enableInterimTranslation",
                  e.target.checked,
                )
              }
              disabled={isDisabled}
            />
          </label>

          <label className="translator-app__setting-row">
            <span>チャンク間隔(ms)</span>
            <input
              type="number"
              value={settings.chunkMs}
              onChange={(e) =>
                handleSettingsChange("chunkMs", Number(e.target.value))
              }
              disabled={isDisabled}
              min={50}
              max={5000}
            />
          </label>

          <label className="translator-app__setting-row">
            <span>無音判定(ms)</span>
            <input
              type="number"
              value={settings.silenceMs}
              onChange={(e) =>
                handleSettingsChange("silenceMs", Number(e.target.value))
              }
              disabled={isDisabled}
              min={100}
              max={10000}
            />
          </label>

          <label className="translator-app__setting-row">
            <span>最大文字数</span>
            <input
              type="number"
              value={settings.maxChars}
              onChange={(e) =>
                handleSettingsChange("maxChars", Number(e.target.value))
              }
              disabled={isDisabled}
              min={10}
              max={500}
            />
          </label>

          <label className="translator-app__setting-row">
            <span>最大秒数</span>
            <input
              type="number"
              value={settings.maxSeconds}
              onChange={(e) =>
                handleSettingsChange("maxSeconds", Number(e.target.value))
              }
              disabled={isDisabled}
              min={1}
              max={60}
            />
          </label>
        </div>
      </details>
    </div>
  );
}
