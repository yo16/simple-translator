"use client";

/**
 * TranslatorApp コンポーネント
 *
 * アプリケーション最上位の Client Component。
 * useReducer で全体状態を管理し、useWebSocket / useRecorder / useAudioQueue を統合する。
 *
 * このコンポーネントは統合ロジックを保持し、UI は子コンポーネントへ委譲する:
 *   - LanguageSelector: 入出力言語の選択
 *   - Recorder: 録音開始/停止/手動区切りボタン群と状態表示
 *   - TranscriptView: interim / 確定発話 / 翻訳結果の表示
 *   - MetricsDisplay: レイテンシ表示
 *   - SettingsPanel: 発話区切り・TTS 設定
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { appReducer, initialState, AppActions } from "../lib/appReducer";
import { useWebSocketWithAudio } from "../hooks/useWebSocket";
import { useRecorder } from "../hooks/useRecorder";
import { useAudioQueue } from "../hooks/useAudioQueue";
import type { AppAction, Settings } from "../lib/types";
import { Recorder } from "./Recorder";
import { LanguageSelector } from "./LanguageSelector";
import { TranscriptView } from "./TranscriptView";
import { MetricsDisplay } from "./MetricsDisplay";
import { SettingsPanel } from "./SettingsPanel";
import styles from "./TranslatorApp.module.css";

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
  // レンダリング
  // ----------------------------------------------------------

  return (
    <div className={styles.translatorApp}>
      <LanguageSelector
        sourceLanguage={settings.sourceLanguage}
        targetLanguage={settings.targetLanguage}
        status={state.status}
        onToggle={handleLanguagePairToggle}
      />

      <Recorder
        status={state.status}
        error={state.error}
        onStart={handleStart}
        onStop={handleStop}
        onCommit={handleCommit}
      />

      <TranscriptView transcript={state.transcript} />

      <MetricsDisplay metrics={state.metrics} />

      <SettingsPanel
        settings={settings}
        status={state.status}
        onSettingsChange={handleSettingsChange}
      />
    </div>
  );
}
