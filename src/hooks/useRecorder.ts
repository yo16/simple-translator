"use client";

/**
 * useRecorder カスタムフック
 *
 * マイク権限取得・MediaRecorder 管理・音声チャンク送信のフック。
 *
 * 設計方針:
 * - startRecording の chunkMs は Settings.chunkMs を使う。
 * - アンマウント時に録音中であれば停止し、MediaStream トラックを解放する。
 * - アンマウント後に非同期処理が走らないよう isUnmountedRef ガードを実装する。
 * - getUserMedia の失敗（マイク権限拒否）はコールバック経由で上位に伝える。
 *
 * SSR 安全性: navigator.mediaDevices / MediaRecorder は startRecording() 内でのみ参照する。
 */

import { useCallback, useEffect, useRef } from "react";
import { startRecording, RecorderHandle } from "../lib/audio";

// ============================================================
// 型定義
// ============================================================

/** useRecorder のオプション */
export interface UseRecorderOptions {
  /**
   * 録音チャンク（base64）を受け取るコールバック。
   * sendAudio への橋渡しに使う。
   */
  onChunk: (base64: string) => void;
  /**
   * エラー発生時のコールバック。
   * マイク権限拒否などのエラーを上位に伝える。
   */
  onError?: (message: string) => void;
}

/** useRecorder の戻り値 */
export interface UseRecorderReturn {
  /**
   * マイク権限を取得して録音を開始する。
   * @param chunkMs チャンク間隔（ms）。省略時はデフォルト（250ms）
   * @returns 成功した場合 true、失敗した場合 false
   */
  startMicRecording: (chunkMs?: number) => Promise<boolean>;
  /**
   * 録音を停止してマイクトラックを解放する。
   */
  stopMicRecording: () => void;
}

// ============================================================
// フック実装
// ============================================================

/**
 * マイク録音を管理するカスタムフック。
 *
 * @param options  onChunk / onError コールバック
 * @returns startMicRecording / stopMicRecording
 */
export function useRecorder(options: UseRecorderOptions): UseRecorderReturn {
  /**
   * アンマウント済みフラグ。
   * アンマウント後に getUserMedia の非同期処理が完了しても副作用が走らないよう制御する。
   */
  const isUnmountedRef = useRef<boolean>(false);

  /**
   * 録音制御ハンドル（startRecording の戻り値）。
   * stop() で録音を停止してトラックを解放する。
   */
  const recorderHandleRef = useRef<RecorderHandle | null>(null);

  /**
   * 現在取得している MediaStream。
   * stopMicRecording 時にトラックを解放するための参照。
   */
  const streamRef = useRef<MediaStream | null>(null);

  /**
   * 最新の onChunk を参照するための ref（stale closure 対策）。
   */
  const onChunkRef = useRef<(base64: string) => void>(options.onChunk);

  /**
   * 最新の onError を参照するための ref（stale closure 対策）。
   */
  const onErrorRef = useRef<((message: string) => void) | undefined>(
    options.onError,
  );

  // options が変わるたびに ref を最新化する
  useEffect(() => {
    onChunkRef.current = options.onChunk;
  }, [options.onChunk]);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  // ----------------------------------------------------------
  // アンマウント時のクリーンアップ
  // ----------------------------------------------------------

  useEffect(() => {
    isUnmountedRef.current = false;

    return () => {
      isUnmountedRef.current = true;

      // 録音中であれば停止してトラックを解放する
      const handle = recorderHandleRef.current;
      if (handle !== null) {
        handle.stop();
        recorderHandleRef.current = null;
      }

      // MediaStream のトラックを解放する（handle.stop() が行う場合は冗長だが安全のため）
      const stream = streamRef.current;
      if (stream !== null) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // ----------------------------------------------------------
  // startMicRecording: マイク権限取得 → 録音開始
  // ----------------------------------------------------------

  const startMicRecording = useCallback(
    async (chunkMs?: number): Promise<boolean> => {
      if (isUnmountedRef.current) return false;

      // 既に録音中の場合は停止してから開始する
      const existingHandle = recorderHandleRef.current;
      if (existingHandle !== null) {
        existingHandle.stop();
        recorderHandleRef.current = null;
      }
      if (streamRef.current !== null) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        if (isUnmountedRef.current) return false;

        const message =
          err instanceof Error
            ? `マイクへのアクセスが拒否されました: ${err.message}`
            : "マイクへのアクセスに失敗しました";

        onErrorRef.current?.(message);
        return false;
      }

      // getUserMedia の await 中にアンマウントされた場合
      if (isUnmountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      streamRef.current = stream;

      // startRecording でチャンクを base64 化してコールバックへ渡す
      const handle = startRecording(
        stream,
        (base64: string) => {
          // アンマウント後のコールバック呼び出しを防ぐ
          if (isUnmountedRef.current) return;
          onChunkRef.current(base64);
        },
        chunkMs,
      );

      recorderHandleRef.current = handle;
      return true;
    },
    [],
  );

  // ----------------------------------------------------------
  // stopMicRecording: 録音停止・トラック解放
  // ----------------------------------------------------------

  const stopMicRecording = useCallback(() => {
    const handle = recorderHandleRef.current;
    if (handle !== null) {
      handle.stop();
      recorderHandleRef.current = null;
    }

    // streamRef は handle.stop() 内の stream.getTracks().forEach で解放済みだが、
    // ref をクリアしておく
    streamRef.current = null;
  }, []);

  return {
    startMicRecording,
    stopMicRecording,
  };
}
