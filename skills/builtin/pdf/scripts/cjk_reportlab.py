"""ReportLab helpers for generating PDFs that contain CJK text.

ReportLab's built-in western fonts cannot render Chinese, Japanese, or Korean
text. Use these helpers before drawing any visible text in a CJK document.
Modern CJK fonts cover Latin text and numbers, so a CJK PDF should use the
registered CJK font globally instead of mixing in western fonts.
"""

from __future__ import annotations

import glob
import os
import re
from pathlib import Path
from typing import Iterable, Optional, Set, Union

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont

CJK_RE = re.compile(
    r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]"
)
REPLACEMENT_GLYPH_RE = re.compile(r"[\u25a0\u25a1\ufffd]")

DEFAULT_FONT_NAME = "CJK"
CID_FALLBACK_FONT_NAME = "STSong-Light"

COMMON_CJK_FONT_PATTERNS = [
    # macOS TrueType collections. Keep STHeiti before Hiragino because some
    # Hiragino TTC files use CFF outlines, which ReportLab TTFont cannot load.
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/AssetsV2/com_apple_MobileAsset_Font*/**/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    # Windows.
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/msyh.ttf",
    "C:/Windows/Fonts/simsun.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    # Linux distributions with Noto or Source Han installed.
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf",
    "/usr/share/fonts/opentype/source-han-serif/SourceHanSerifSC-Regular.otf",
]


def contains_cjk(text: str) -> bool:
    return bool(CJK_RE.search(text or ""))


def contains_replacement_glyphs(text: str) -> bool:
    return bool(REPLACEMENT_GLYPH_RE.search(text or ""))


def _iter_env_font_paths() -> Iterable[str]:
    for env_name in ("BIZOWL_PDF_CJK_FONT", "PDF_CJK_FONT", "CJK_FONT_PATH"):
        raw = os.environ.get(env_name, "")
        for value in raw.split(os.pathsep):
            value = value.strip()
            if value:
                yield value


def iter_cjk_font_candidates(extra_paths: Optional[Iterable[str]] = None) -> Iterable[str]:
    seen: Set[str] = set()
    for candidate in [
        *_iter_env_font_paths(),
        *(extra_paths or []),
        *COMMON_CJK_FONT_PATTERNS,
    ]:
        matches = (
            glob.glob(candidate, recursive=True)
            if glob.has_magic(candidate)
            else [candidate]
        )
        for match in matches:
            path = str(Path(match).expanduser())
            if path in seen or not Path(path).is_file():
                continue
            seen.add(path)
            yield path


def _try_register_ttfont(font_name: str, font_path: str) -> Optional[dict]:
    # TTC files can contain multiple subfonts. Try a small index range because
    # ReportLab only loads TrueType outlines and some subfonts may be CFF.
    for subfont_index in range(10):
        try:
            pdfmetrics.registerFont(
                TTFont(font_name, font_path, subfontIndex=subfont_index)
            )
            pdfmetrics.registerFontFamily(
                font_name,
                normal=font_name,
                bold=font_name,
                italic=font_name,
                boldItalic=font_name,
            )
            return {
                "font_name": font_name,
                "font_path": font_path,
                "embedded": True,
                "subfont_index": subfont_index,
            }
        except TypeError:
            try:
                pdfmetrics.registerFont(TTFont(font_name, font_path))
                pdfmetrics.registerFontFamily(
                    font_name,
                    normal=font_name,
                    bold=font_name,
                    italic=font_name,
                    boldItalic=font_name,
                )
                return {
                    "font_name": font_name,
                    "font_path": font_path,
                    "embedded": True,
                    "subfont_index": None,
                }
            except Exception:
                break
        except Exception:
            continue
    return None


def register_cjk_font(
    font_name: str = DEFAULT_FONT_NAME,
    extra_paths: Optional[Iterable[str]] = None,
    allow_cid_fallback: bool = True,
) -> dict:
    """Register a ReportLab font that can render CJK text.

    Returns metadata with the registered font name. A TrueType/TTC font is
    preferred because it is embedded in the PDF. If none can be registered,
    ReportLab's STSong-Light CID font is used as a last resort when allowed.
    """

    for font_path in iter_cjk_font_candidates(extra_paths):
        info = _try_register_ttfont(font_name, font_path)
        if info:
            return info

    if allow_cid_fallback:
        pdfmetrics.registerFont(UnicodeCIDFont(CID_FALLBACK_FONT_NAME))
        pdfmetrics.registerFontFamily(
            CID_FALLBACK_FONT_NAME,
            normal=CID_FALLBACK_FONT_NAME,
            bold=CID_FALLBACK_FONT_NAME,
            italic=CID_FALLBACK_FONT_NAME,
            boldItalic=CID_FALLBACK_FONT_NAME,
        )
        return {
            "font_name": CID_FALLBACK_FONT_NAME,
            "font_path": None,
            "embedded": False,
            "subfont_index": None,
        }

    raise RuntimeError(
        "No ReportLab-compatible CJK font was found. Set BIZOWL_PDF_CJK_FONT "
        "to a .ttf/.ttc/.otf font that covers Chinese, Japanese, or Korean."
    )


def apply_cjk_font_to_styles(styles, font_name: str) -> None:
    """Set CJK font fields on every style in a ReportLab StyleSheet1."""

    for style in styles.byName.values():
        style.fontName = font_name
        if hasattr(style, "bulletFontName"):
            style.bulletFontName = font_name


def extract_pdf_text(pdf_path: Union[str, os.PathLike]) -> Optional[str]:
    """Extract PDF text with pypdf or PyPDF2 when either package is available."""

    for module_name in ("pypdf", "PyPDF2"):
        try:
            module = __import__(module_name, fromlist=["PdfReader"])
            reader = module.PdfReader(str(pdf_path))
            return "".join(page.extract_text() or "" for page in reader.pages)
        except ModuleNotFoundError:
            continue
        except Exception:
            continue
    return None


def verify_cjk_pdf_text(
    pdf_path: Union[str, os.PathLike],
    expected_text: str,
    reject_replacement_glyphs: bool = True,
) -> bool:
    """Return True when extracted text contains the expected CJK sample."""

    extracted = extract_pdf_text(pdf_path)
    if extracted is None:
        return False
    if reject_replacement_glyphs and contains_replacement_glyphs(extracted):
        return False
    return expected_text in extracted
