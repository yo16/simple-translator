"use client";

/**
 * useAudioQueue カスタムフック
 *
 * 受信した MP3 base64 チャンクを FIFO キューで順次再生する。
 *
 * 設計方針:
 * - AudioContext は最初の enqueue 呼び出し時に遅延生成する（AutoPlay Policy 対策）。
 * - AudioContext.decodeAudioData で MP3 → AudioBuffer に変換し、
 *   AudioBufferSourceNode.start(nextStartTime) で隙間なく連続再生する。
 * - 前のチャンクの終了予定時刻（nextStartTime）に次チャンクを開始することで途切れを防ぐ。
 * - アンマウント時に AudioContext を close() してリソースリークを防ぐ。
 *
 * SSR 安全性: AudioContext / window は useEffect / イベントハンドラ内でのみ参照する。
 */

import { useCallback, useEffect, useRef } from "react";

// ============================================================
// 型定義
// ============================================================

/** useAudioQueue の戻り値 */
export interface AudioQueueHandle {
  /**
   * MP3 base64 文字列をキューに追加して再生をスケジュールする。
   * AudioContext は初回呼び出し時に遅延生成される。
   */
  enqueue: (base64: string) => void;
  /**
   * 再生を停止してキューをクリアする（任意）。
   * 再接続時など、キューをリセットしたい場合に使う。
   */
  reset: () => void;
}

// ============================================================
// base64 → ArrayBuffer 変換ユーティリティ（内部専用）
// ============================================================

/**
 * base64 文字列を ArrayBuffer に変換する。
 *
 * @param base64 変換元 base64 文字列
 * @returns ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// ============================================================
// フック実装
// ============================================================

/**
 * MP3 base64 チャンクを FIFO キューで順次再生するフック。
 *
 * @returns AudioQueueHandle（enqueue / reset）
 */
export function useAudioQueue(): AudioQueueHandle {
  /**
   * アンマウント済みフラグ。
   * アンマウント後に非同期の enqueue が呼ばれても AudioContext を再生成しないよう制御する。
   */
  const isUnmountedRef = useRef<boolean>(false);

  /**
   * AudioContext インスタンス（遅延生成）。
   * 初回 enqueue 呼び出し時に生成する。
   */
  const audioContextRef = useRef<AudioContext | null>(null);

  /**
   * 次のチャンク再生を開始すべき AudioContext 時刻（秒）。
   * AudioContext.currentTime を基点に、各チャンクの duration を加算していく。
   */
  const nextStartTimeRef = useRef<number>(0);

  /**
   * 処理中フラグ。
   * enqueue 呼び出しが並走した場合のデコード順序を保証するためのキュー。
   * 複数の非同期デコードが同時に走る可能性があるため、
   * デコード完了順ではなく enqueue 順で再生するよう処理キューを使う。
   */
  const processingQueueRef = useRef<Promise<void>>(Promise.resolve());

  // ----------------------------------------------------------
  // AudioContext の遅延生成
  // ----------------------------------------------------------

  /**
   * AudioContext を取得する。未生成の場合は生成して返す。
   * Safari 対応のため window.webkitAudioContext にもフォールバックする。
   */
  const getOrCreateAudioContext = useCallback((): AudioContext => {
    if (audioContextRef.current !== null) {
      return audioContextRef.current;
    }

    // Safari 対応: window.webkitAudioContext が存在する場合はそちらを使う
    const AudioContextClass =
      window.AudioContext ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    const ctx = new AudioContextClass();
    audioContextRef.current = ctx;

    // nextStartTime の初期値は現在時刻（再生可能な最短時刻）
    nextStartTimeRef.current = ctx.currentTime;

    return ctx;
  }, []);

  // ----------------------------------------------------------
  // アンマウント時のクリーンアップ
  // ----------------------------------------------------------

  useEffect(() => {
    return () => {
      // アンマウント済みフラグを立てる（以降の非同期 enqueue でリークが発生しないよう制御）
      isUnmountedRef.current = true;

      // AudioContext を close してリソースを解放する
      const ctx = audioContextRef.current;
      if (ctx !== null) {
        ctx.close().catch((err: unknown) => {
          console.error("[useAudioQueue] Failed to close AudioContext:", err);
        });
        audioContextRef.current = null;
      }
    };
  }, []);

  // ----------------------------------------------------------
  // enqueue: チャンクをキューに追加して再生をスケジュールする
  // ----------------------------------------------------------

  const enqueue = useCallback(
    (base64: string) => {
      // アンマウント済みの場合は即座に何もしない（AudioContext 再生成によるリーク防止）
      if (isUnmountedRef.current) return;

      // 処理キューに連鎖させることで enqueue 順（FIFO）を保証する
      processingQueueRef.current = processingQueueRef.current.then(async () => {
        // キューに積まれた後でアンマウントされた場合も処理を中止する
        if (isUnmountedRef.current) return;

        let ctx: AudioContext;
        try {
          ctx = getOrCreateAudioContext();
        } catch (err) {
          console.error("[useAudioQueue] Failed to create AudioContext:", err);
          return;
        }

        // AudioContext が suspended 状態の場合は resume する（AutoPlay Policy 対策）
        if (ctx.state === "suspended") {
          try {
            await ctx.resume();
          } catch (err) {
            console.error("[useAudioQueue] Failed to resume AudioContext:", err);
          }
        }

        // base64 → ArrayBuffer → AudioBuffer にデコード
        // デコード前に再度アンマウント確認（resume の await 中にアンマウントされた場合）
        if (isUnmountedRef.current || audioContextRef.current === null) return;

        let audioBuffer: AudioBuffer;
        try {
          const arrayBuffer = base64ToArrayBuffer(base64);
          audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        } catch (err) {
          console.error("[useAudioQueue] Failed to decode audio data:", err);
          return;
        }

        // デコード完了後に再度アンマウント確認（decodeAudioData の await 中にアンマウントされた場合）
        if (isUnmountedRef.current || audioContextRef.current === null) return;

        // 次の再生開始時刻を決定する
        // nextStartTime が過去（currentTime より前）の場合は currentTime を使う
        const startTime = Math.max(nextStartTimeRef.current, ctx.currentTime);

        // AudioBufferSourceNode を生成して再生をスケジュールする
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start(startTime);

        // 次のチャンクの開始時刻を更新する（途切れなく連続再生するための計算）
        nextStartTimeRef.current = startTime + audioBuffer.duration;
      });
    },
    [getOrCreateAudioContext],
  );

  // ----------------------------------------------------------
  // reset: 再生停止・キュークリア
  // ----------------------------------------------------------

  const reset = useCallback(() => {
    // 処理キューをリセット（以降の enqueue は新しいキューに積まれる）
    processingQueueRef.current = Promise.resolve();

    // AudioContext を close して再生を強制停止し、新しいインスタンスを生成できる状態にする
    const ctx = audioContextRef.current;
    if (ctx !== null) {
      ctx.close().catch((err: unknown) => {
        console.error("[useAudioQueue] Failed to close AudioContext on reset:", err);
      });
      audioContextRef.current = null;
    }

    // 次回 enqueue 時に AudioContext が再生成されるため、nextStartTime のリセットは不要
    // （getOrCreateAudioContext 内で ctx.currentTime を基点に設定される）
  }, []);

  return { enqueue, reset };
}
