// =============================================================
// 介绍视频欢迎页 — 项目 Hero，进入系统前播放
// 修复: 底部 CTA 始终可见，视频未加载时显示渐变底色而非纯黑
// =============================================================

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export function WelcomePage() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [showOverlay, setShowOverlay] = useState(true)
  const [ended, setEnded] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  // R95 修复: 跟踪事件处理器中的 setTimeout,组件卸载时清理
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = true
    const playPromise = v.play()
    if (playPromise) {
      playPromise.catch(() => {
        setShowOverlay(true)
      })
    }
    // 标题/跳过 4s 后淡出，但底部 CTA 始终保留
    const t = setTimeout(() => setShowOverlay(false), 4000)
    return () => {
      clearTimeout(t)
      if (overlayTimerRef.current) {
        clearTimeout(overlayTimerRef.current)
        overlayTimerRef.current = null
      }
    }
  }, [])

  const handleEnter = () => {
    navigate('/dashboard')
  }

  const handleReplay = () => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = 0
    setEnded(false)
    v.play().catch(() => {})
    setShowOverlay(true)
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current)
    overlayTimerRef.current = setTimeout(() => setShowOverlay(false), 4000)
  }

  const handleUnmute = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setShowOverlay(true)
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current)
    overlayTimerRef.current = setTimeout(() => setShowOverlay(false), 2500)
  }

  return (
    <div
      className="relative w-full h-full bg-[#0f1117] overflow-hidden cursor-pointer"
      onMouseMove={() => setShowOverlay(true)}
      onMouseLeave={() => !ended && setShowOverlay(false)}
    >
      {/* 视频未加载时的渐变底色，避免纯黑 */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0f1117] via-[#161920] to-[#1a1e28]" />

      <video
        ref={videoRef}
        src="./intro.mp4"
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${videoReady ? 'opacity-100' : 'opacity-0'}`}
        playsInline
        onCanPlay={() => setVideoReady(true)}
        onEnded={() => {
          setEnded(true)
          setShowOverlay(true)
        }}
        onClick={() => {
          const v = videoRef.current
          if (v?.paused) v.play().catch(() => {})
        }}
      >
        <track kind="captions" />
      </video>

      {/* 渐变蒙板：让标题文字更可读 */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40 pointer-events-none" />

      {/* 标题层（视频上方）— 会淡出 */}
      <div
        className={`absolute inset-x-0 top-0 pt-12 px-8 transition-opacity duration-500 ${
          showOverlay ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="max-w-5xl mx-auto flex items-center gap-3 text-white">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/20">
            E
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight">Education Advisor</div>
            <div className="text-xs text-white/70">教育操作系统 · 让老师回到讲台</div>
          </div>
        </div>
      </div>

      {/* 底部 CTA 区 — 始终可见 */}
      <div className="absolute inset-x-0 bottom-0 pb-14">
        <div className="max-w-5xl mx-auto px-8 text-center text-white">
          <h1
            className={`text-3xl md:text-4xl font-bold tracking-tight drop-shadow-lg transition-opacity duration-500 ${
              showOverlay || ended ? 'opacity-100' : 'opacity-70'
            }`}
          >
            让老师回到讲台
          </h1>
          <p className="mt-2 text-sm md:text-base text-white/80 drop-shadow">
            18 个 Agent · 本地优先 · 可审计
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleEnter}
              className="px-7 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium shadow-lg shadow-blue-500/25 transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]"
            >
              进入系统 →
            </button>
            {ended && (
              <button
                type="button"
                onClick={handleReplay}
                className="px-5 py-2.5 rounded-lg bg-white/15 hover:bg-white/25 backdrop-blur text-white text-sm font-medium border border-white/20 transition-colors"
              >
                重播
              </button>
            )}
            <button
              type="button"
              onClick={handleUnmute}
              className="px-3 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 backdrop-blur text-white text-xs font-medium border border-white/20 transition-colors"
              title={videoRef.current?.muted ? '取消静音' : '静音'}
            >
              {videoRef.current?.muted ? '🔇' : '🔊'}
            </button>
          </div>
        </div>
      </div>

      {/* 跳过按钮 — 会淡出 */}
      {!ended && (
        <button
          type="button"
          onClick={handleEnter}
          className={`absolute top-12 right-8 text-white/70 hover:text-white text-xs px-3 py-1.5 rounded-md bg-black/30 hover:bg-black/50 backdrop-blur transition-all duration-500 ${
            showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          跳过介绍 →
        </button>
      )}
    </div>
  )
}

export default WelcomePage
