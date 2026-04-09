"""
Content Analysis Service — AI-powered content analysis for creators.

Orchestrates transcript fetching, thumbnail analysis, and LLM-powered insights.
Runs as a background task with progress tracking.
"""

import json
import logging
from datetime import datetime
from typing import List, Dict, Any

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


async def run_analysis(analysis_id: int, db_factory):
    """
    Run a full content analysis. Called as a background task.

    Steps:
    1. Gather cached video data
    2. Fetch transcripts (youtube-transcript-api)
    3. Analyze thumbnails (VLM via bridge)
    4. Build mega-prompt and call LLM
    5. Parse and store results
    """
    from models import ContentAnalysis, YouTubeChannel, YouTubeVideo, VideoTranscript, ThumbnailAnalysis
    from services.integration_client import integration

    db: Session = db_factory()

    try:
        analysis = db.query(ContentAnalysis).filter(ContentAnalysis.id == analysis_id).first()
        if not analysis:
            return
        analysis.status = "running"
        analysis.progress = 5
        analysis.progress_message = "Gathering video data..."
        db.commit()

        # ── Step 1: Gather data ──────────────────────────────────────────
        channels = db.query(YouTubeChannel).all()
        videos = db.query(YouTubeVideo).all()

        if not videos:
            analysis.status = "failed"
            analysis.error_message = "No videos cached. Run YouTube Sync first."
            db.commit()
            return

        analysis.video_count_analyzed = len(videos)
        analysis.progress = 10
        analysis.progress_message = f"Found {len(videos)} videos. Fetching transcripts..."
        db.commit()

        # ── Step 2: Fetch transcripts ────────────────────────────────────
        for i, video in enumerate(videos):
            existing = db.query(VideoTranscript).filter(VideoTranscript.video_id == video.video_id).first()
            if existing and existing.transcript_text:
                continue  # Already cached

            transcript_text = ""
            try:
                from youtube_transcript_api import YouTubeTranscriptApi
                transcript_list = YouTubeTranscriptApi.get_transcript(video.video_id)
                transcript_text = " ".join([t["text"] for t in transcript_list])
            except Exception as e:
                logger.info(f"[ANALYSIS] No transcript for {video.video_id}: {e}")
                transcript_text = "(No transcript available)"

            if existing:
                existing.transcript_text = transcript_text[:10000]
                existing.fetched_at = datetime.utcnow()
            else:
                db.add(VideoTranscript(
                    video_id=video.video_id,
                    transcript_text=transcript_text[:10000],
                ))
            db.commit()

            progress = 10 + int((i + 1) / len(videos) * 25)
            analysis.progress = progress
            analysis.progress_message = f"Fetched transcript {i + 1}/{len(videos)}: {video.title[:40]}..."
            db.commit()

        # ── Step 3: Analyze thumbnails ───────────────────────────────────
        analysis.progress = 40
        analysis.progress_message = "Analyzing thumbnails..."
        db.commit()

        for i, video in enumerate(videos):
            existing = db.query(ThumbnailAnalysis).filter(ThumbnailAnalysis.video_id == video.video_id).first()
            if existing and existing.analysis_text:
                continue  # Already cached

            thumbnail_desc = ""
            if video.thumbnail_url and integration.available:
                thumbnail_desc = await integration.vlm_describe(
                    video.thumbnail_url,
                    "Analyze this YouTube thumbnail. Describe: visual elements, text overlays, colors, "
                    "composition, emotional tone, clickbait elements, and what makes it compelling or not. "
                    "Be specific and concise (2-3 sentences)."
                )

            if not thumbnail_desc:
                thumbnail_desc = "(No thumbnail analysis available)"

            if existing:
                existing.analysis_text = thumbnail_desc
                existing.analyzed_at = datetime.utcnow()
            else:
                db.add(ThumbnailAnalysis(
                    video_id=video.video_id,
                    analysis_text=thumbnail_desc,
                ))
            db.commit()

            progress = 40 + int((i + 1) / len(videos) * 25)
            analysis.progress = progress
            analysis.progress_message = f"Analyzed thumbnail {i + 1}/{len(videos)}: {video.title[:40]}..."
            db.commit()

        # ── Step 4: Build analysis prompt ────────────────────────────────
        analysis.progress = 70
        analysis.progress_message = "Running AI analysis..."
        db.commit()

        channel = channels[0] if channels else None
        transcripts = {t.video_id: t for t in db.query(VideoTranscript).all()}
        thumbnails = {t.video_id: t for t in db.query(ThumbnailAnalysis).all()}

        # Build video data for the prompt
        video_data = []
        for v in videos:
            transcript = transcripts.get(v.video_id)
            thumbnail = thumbnails.get(v.video_id)
            video_data.append({
                "title": v.title,
                "description": (v.description or "")[:300],
                "published_at": v.published_at,
                "duration": v.duration,
                "views": v.view_count,
                "likes": v.like_count,
                "comments": v.comment_count,
                "engagement_rate": round((v.like_count + v.comment_count) / max(v.view_count, 1) * 100, 2),
                "transcript_excerpt": (transcript.transcript_text[:1500] if transcript else ""),
                "thumbnail_analysis": (thumbnail.analysis_text if thumbnail else ""),
            })

        channel_info = ""
        if channel:
            channel_info = f"""
Channel: {channel.title}
Subscribers: {channel.subscriber_count}
Total Views: {channel.view_count}
Total Videos: {channel.video_count}
"""

        system_message = """You are an expert YouTube content analyst and growth strategist.
Analyze the creator's content data and provide actionable, specific insights.
Be direct and data-driven. Reference specific videos by name.
Return your analysis as a JSON object with the following structure:

{
  "summary": "2-3 sentence executive summary",
  "performance_ranking": [
    {"title": "video title", "score": 8.5, "reason": "why it performed well/poorly"}
  ],
  "content_categories": [
    {"category": "Gaming Shorts", "video_count": 3, "avg_views": 330, "insight": "..."}
  ],
  "timing_analysis": "insights about posting schedule, duration sweet spots",
  "thumbnail_insights": "what works and doesn't in their thumbnails",
  "recommendations": ["specific actionable recommendation 1", "..."],
  "content_ideas": [
    {"title": "suggested video title", "format": "short/long", "reasoning": "why this would work"}
  ],
  "todos": [
    {"task": "specific actionable task", "priority": "high/medium/low"}
  ]
}

Return ONLY the JSON object, no additional text."""

        prompt = f"""Analyze this YouTube creator's content performance:

{channel_info}

Videos ({len(video_data)} total):
{json.dumps(video_data, indent=2)}

Provide a comprehensive analysis with performance rankings, content category insights,
timing analysis, thumbnail insights, actionable recommendations, content ideas for future videos,
and a prioritized todo list."""

        # ── Step 5: Call LLM ─────────────────────────────────────────────
        analysis.progress = 75
        analysis.progress_message = "AI is analyzing your content..."
        db.commit()

        llm_response = await integration.llm_complete(prompt, system_message)

        if not llm_response:
            analysis.status = "failed"
            analysis.error_message = "LLM returned empty response. Check your LLM configuration."
            db.commit()
            return

        # ── Step 6: Parse and store results ──────────────────────────────
        analysis.progress = 95
        analysis.progress_message = "Processing results..."
        db.commit()

        # Try to parse as JSON
        try:
            # Strip markdown code fences if present
            cleaned = llm_response.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()

            report = json.loads(cleaned)
        except json.JSONDecodeError:
            # LLM didn't return valid JSON — store raw text as summary
            report = {}
            analysis.summary = llm_response

        if isinstance(report, dict):
            analysis.report_json = report
            analysis.summary = report.get("summary", "")
            analysis.recommendations = report.get("recommendations", [])
            analysis.todos = report.get("todos", [])
            analysis.content_ideas = report.get("content_ideas", [])

        analysis.status = "completed"
        analysis.progress = 100
        analysis.progress_message = "Analysis complete"
        analysis.completed_at = datetime.utcnow()
        db.commit()

        logger.info(f"[ANALYSIS] Completed analysis {analysis_id}: {len(videos)} videos analyzed")

    except Exception as e:
        logger.error(f"[ANALYSIS] Failed: {e}")
        try:
            analysis = db.query(ContentAnalysis).filter(ContentAnalysis.id == analysis_id).first()
            if analysis:
                analysis.status = "failed"
                analysis.error_message = str(e)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()
