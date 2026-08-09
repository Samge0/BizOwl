#!/usr/bin/env python3
"""Compile a Markdown/plain-text report into document files.

The compiler intentionally uses only the Python standard library so it can run
inside BizOwl without installing extra packages. It supports the Markdown
features that business reports most commonly need: headings, paragraphs,
tables, lists, block quotes, code blocks, links, and inline emphasis.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import importlib.util
import math
import os
import re
import shutil
import subprocess
import sys
import textwrap
import zipfile
from dataclasses import dataclass, field, replace
from pathlib import Path


Block = dict[str, object]

DOCX_PAGE_WIDTH_DXA = 11906
DOCX_PAGE_HEIGHT_DXA = 16838
DOCX_PAGE_MARGIN_DXA = 1440
DOCX_CONTENT_WIDTH_DXA = DOCX_PAGE_WIDTH_DXA - DOCX_PAGE_MARGIN_DXA * 2

AI_DISCLAIMER_TEXT = "内容由AI生成，请仔细甄别"

SPECIAL_SECTION_KEYWORDS = {
    "abstract": ("摘要", "概览", "速览", "总览", "概要"),
    "conclusion": ("核心结论", "结论", "主要结论", "分析结论"),
    "risk": ("风险", "风险提示", "风险关注", "预警"),
    "suggestion": ("建议", "处置建议", "行动建议", "下一步"),
    "data": ("数据", "明细", "清单", "项目", "表格"),
}

FRONT_MATTER_KEYWORDS = (
    "报告生成时间",
    "报告时间",
    "报告日期",
    "查询时间",
    "导出时间",
    "数据来源",
    "数据口径",
)


class BlockType:
    Heading = "heading"
    Paragraph = "paragraph"
    Quote = "quote"
    List = "list"
    Table = "table"
    Code = "code"
    Rule = "rule"


class ReportFormat:
    Html = "html"
    Pdf = "pdf"
    Docx = "docx"
    Xlsx = "xlsx"
    Pptx = "pptx"
    Csv = "csv"
    Markdown = "md"


class ReportLayout:
    Report = "report"
    Plain = "plain"


class ReportTemplate:
    EnterpriseCredit = "enterprise_credit"
    RiskScan = "risk_scan"
    BidCredit = "bid_credit"
    ExecutiveProfile = "executive_profile"
    RelatedParty = "related_party"
    Generic = "generic"


PLAIN_DOCUMENT_TITLE_KEYWORDS = (
    "合同",
    "协议",
    "授权书",
    "授权委托书",
    "委托书",
    "承诺书",
    "声明",
    "函",
    "通知",
    "决议",
    "章程",
    "制度",
    "意向书",
    "备忘录",
)

REPORT_DOCUMENT_TITLE_KEYWORDS = (
    "报告",
    "分析",
    "评估",
    "核查",
    "尽调",
    "调研",
    "扫描",
    "画像",
    "清单",
    "汇总",
)

PLAIN_DOCUMENT_BODY_KEYWORDS = (
    "甲方",
    "乙方",
    "丙方",
    "委托方",
    "受托方",
    "授权人",
    "被授权人",
    "合同编号",
    "协议编号",
    "违约责任",
    "争议解决",
    "签署",
    "盖章",
    "生效",
    "有效期",
)


class ReportThemeId:
    Auto = "auto"
    Business = "business"
    Risk = "risk"
    Bid = "bid"
    IntellectualProperty = "ip"
    Equity = "equity"
    Executive = "executive"
    Relation = "relation"
    Dark = "dark"


class ReportThemeVariantId:
    BusinessSignalNavy = "business-signal-navy"
    BusinessBlueProfessional = "business-blue-professional"
    BusinessWarmMonochrome = "business-warm-monochrome"
    BusinessCartesianNeutral = "business-cartesian-neutral"
    RiskBurgundyAmber = "risk-burgundy-amber"
    RiskRosewood = "risk-rosewood"
    RiskSlateRed = "risk-slate-red"
    BidSageTerracotta = "bid-sage-terracotta"
    BidTealSupply = "bid-teal-supply"
    BidOliveProcurement = "bid-olive-procurement"
    IpCobaltResearch = "ip-cobalt-research"
    IpVioletLab = "ip-violet-lab"
    IpSlateCyan = "ip-slate-cyan"
    EquityForestCapital = "equity-forest-capital"
    EquityClayLedger = "equity-clay-ledger"
    EquityEmeraldGold = "equity-emerald-gold"
    ExecutiveSignalBoard = "executive-signal-board"
    ExecutiveSteelTeal = "executive-steel-teal"
    ExecutiveWarmSlate = "executive-warm-slate"
    RelationPlumNetwork = "relation-plum-network"
    RelationAubergineGold = "relation-aubergine-gold"
    RelationIndigo = "relation-indigo"


class ReportStyleProfile:
    Classic = "classic"
    Framed = "framed"
    Ledger = "ledger"
    Rail = "rail"
    Editorial = "editorial"


REPORT_STYLE_PROFILE_SEQUENCE = (
    ReportStyleProfile.Classic,
    ReportStyleProfile.Framed,
    ReportStyleProfile.Ledger,
    ReportStyleProfile.Rail,
    ReportStyleProfile.Editorial,
)


@dataclass(frozen=True)
class ReportTheme:
    id: str
    name: str
    page_bg: str
    paper_bg: str
    text: str
    muted: str
    subtle: str
    line: str
    accent: str
    accent_strong: str
    accent_soft: str
    brand: str
    risk: str
    risk_soft: str
    success: str
    success_soft: str
    warning: str
    table_header_fill: str
    table_header_text: str
    quote_bg: str
    code_bg: str
    chart_colors: tuple[str, ...]
    module_colors: tuple[str, ...] = ()
    style_profile: str = ReportStyleProfile.Classic


REPORT_THEMES: dict[str, ReportTheme] = {
    ReportThemeId.Business: ReportTheme(
        id=ReportThemeId.Business,
        name="Institutional Navy",
        page_bg="F5F7FA",
        paper_bg="FFFFFF",
        text="172033",
        muted="667085",
        subtle="F2F4F7",
        line="D0D5DD",
        accent="2563EB",
        accent_strong="1E3A8A",
        accent_soft="EFF6FF",
        brand="D92D20",
        risk="B42318",
        risk_soft="FEF3F2",
        success="027A48",
        success_soft="ECFDF3",
        warning="B54708",
        table_header_fill="1E3A8A",
        table_header_text="FFFFFF",
        quote_bg="F8FAFC",
        code_bg="F6F8FA",
        chart_colors=("2563EB", "0E7490", "12B76A", "F79009", "D92D20", "7C3AED", "667085", "344054"),
    ),
    ReportThemeId.Risk: ReportTheme(
        id=ReportThemeId.Risk,
        name="Legal Burgundy",
        page_bg="F7F4F2",
        paper_bg="FFFFFF",
        text="261B1B",
        muted="725F5F",
        subtle="F5ECEA",
        line="E2CCC7",
        accent="8E2F3C",
        accent_strong="5B1E28",
        accent_soft="F8EDEF",
        brand="8E2F3C",
        risk="A61B1B",
        risk_soft="FCEEEE",
        success="25795C",
        success_soft="EAF4EF",
        warning="B7791F",
        table_header_fill="5B1E28",
        table_header_text="FFFFFF",
        quote_bg="F8F0EE",
        code_bg="F6F1EF",
        chart_colors=("8E2F3C", "5B1E28", "B7791F", "A61B1B", "25795C", "4E6E8E", "776A6A", "B85C5C"),
    ),
    ReportThemeId.Bid: ReportTheme(
        id=ReportThemeId.Bid,
        name="Finance Emerald",
        page_bg="F4F7F4",
        paper_bg="FFFFFF",
        text="10231C",
        muted="5F6F67",
        subtle="EEF5F0",
        line="CDDDD3",
        accent="16745B",
        accent_strong="0B3D33",
        accent_soft="E8F4EF",
        brand="9A6A2F",
        risk="A33A2F",
        risk_soft="FDEDE8",
        success="16745B",
        success_soft="E8F4EF",
        warning="A66A1F",
        table_header_fill="0B3D33",
        table_header_text="FFFFFF",
        quote_bg="F2F7F3",
        code_bg="F5F6F2",
        chart_colors=("16745B", "0B3D33", "9A6A2F", "2F6F88", "7A8B76", "A33A2F", "6B7280", "315A75"),
    ),
    ReportThemeId.IntellectualProperty: ReportTheme(
        id=ReportThemeId.IntellectualProperty,
        name="Tech Indigo",
        page_bg="F6F7FB",
        paper_bg="FFFFFF",
        text="171A2B",
        muted="626679",
        subtle="F1F2FA",
        line="D9DCEF",
        accent="4F46E5",
        accent_strong="312E81",
        accent_soft="EEF2FF",
        brand="4F46E5",
        risk="B42318",
        risk_soft="FEF3F2",
        success="047857",
        success_soft="ECFDF5",
        warning="B45309",
        table_header_fill="312E81",
        table_header_text="FFFFFF",
        quote_bg="F5F6FF",
        code_bg="F6F7FB",
        chart_colors=("4F46E5", "312E81", "06B6D4", "047857", "B45309", "B42318", "7C3AED", "667085"),
    ),
    ReportThemeId.Equity: ReportTheme(
        id=ReportThemeId.Equity,
        name="Capital Olive",
        page_bg="F5F6F0",
        paper_bg="FFFFFB",
        text="17251E",
        muted="647067",
        subtle="F0F4EA",
        line="D8E0D1",
        accent="2F6F4E",
        accent_strong="163B2E",
        accent_soft="EAF4EA",
        brand="A36D2A",
        risk="A33A2F",
        risk_soft="FDEDE8",
        success="2F6F4E",
        success_soft="EAF4EA",
        warning="A36D2A",
        table_header_fill="163B2E",
        table_header_text="FFFFFB",
        quote_bg="F3F6EF",
        code_bg="F6F6F0",
        chart_colors=("2F6F4E", "163B2E", "A36D2A", "507D8C", "7A8B76", "A33A2F", "6B7280", "315A75"),
    ),
    ReportThemeId.Executive: ReportTheme(
        id=ReportThemeId.Executive,
        name="Boardroom Blue Gray",
        page_bg="F3F5F7",
        paper_bg="FFFFFF",
        text="182230",
        muted="667085",
        subtle="F1F5F9",
        line="CBD5E1",
        accent="315A75",
        accent_strong="1F3A4D",
        accent_soft="EAF2F7",
        brand="315A75",
        risk="B42318",
        risk_soft="FEF3F2",
        success="027A48",
        success_soft="ECFDF3",
        warning="B54708",
        table_header_fill="1F3A4D",
        table_header_text="FFFFFF",
        quote_bg="F6F8FA",
        code_bg="F4F6F8",
        chart_colors=("315A75", "5B7C99", "0F766E", "84A59D", "B54708", "B42318", "667085", "1F3A4D"),
    ),
    ReportThemeId.Relation: ReportTheme(
        id=ReportThemeId.Relation,
        name="Corporate Plum",
        page_bg="F7F5F8",
        paper_bg="FFFFFF",
        text="231B2E",
        muted="6D6470",
        subtle="F3EEF6",
        line="DED3E7",
        accent="6D4A7E",
        accent_strong="422654",
        accent_soft="F4ECF8",
        brand="B7791F",
        risk="A33A2F",
        risk_soft="FDEDE8",
        success="2D7A68",
        success_soft="EAF4EF",
        warning="B7791F",
        table_header_fill="422654",
        table_header_text="FFFFFF",
        quote_bg="F7F2F9",
        code_bg="F6F4F7",
        chart_colors=("6D4A7E", "422654", "B7791F", "2D7A68", "315A75", "A33A2F", "6B7280", "9A7891"),
    ),
    ReportThemeId.Dark: ReportTheme(
        id=ReportThemeId.Dark,
        name="Dark",
        page_bg="101624",
        paper_bg="172033",
        text="F7EFE0",
        muted="B6AFA1",
        subtle="223049",
        line="39445C",
        accent="C8A55A",
        accent_strong="F2D48A",
        accent_soft="273047",
        brand="C8A55A",
        risk="E07A5F",
        risk_soft="3A2522",
        success="65A782",
        success_soft="1F332A",
        warning="D7A84D",
        table_header_fill="222B3D",
        table_header_text="F7EFE0",
        quote_bg="202A40",
        code_bg="0F1522",
        chart_colors=("C8A55A", "F2D48A", "65A782", "E07A5F", "9AB0D3", "B6AFA1", "7A86A1", "D7A84D"),
    ),
}


def with_module_colors(
    theme: ReportTheme,
    *colors: str,
    style_profile: str = ReportStyleProfile.Classic,
) -> ReportTheme:
    return replace(theme, module_colors=tuple(colors), style_profile=style_profile)


REPORT_THEME_VARIANTS: dict[str, tuple[ReportTheme, ...]] = {
    ReportThemeId.Business: (
        with_module_colors(
            REPORT_THEMES[ReportThemeId.Business],
            "2563EB", "0E7490", "12B76A", "F79009", "7C3AED", "344054",
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Business],
            id=ReportThemeVariantId.BusinessSignalNavy,
            name="Signal Navy",
            page_bg="F0ECE3",
            paper_bg="FFFFFF",
            text="1C2644",
            muted="667085",
            subtle="F4F1EA",
            line="D8D0C4",
            accent="C8A870",
            accent_strong="1C2644",
            accent_soft="F5EFE2",
            table_header_fill="1C2644",
            table_header_text="F4EFE6",
            chart_colors=("1C2644", "C8A870", "4E6E8E", "667085", "8E6F3E", "A0473A", "2E5F4D", "232F55"),
            module_colors=("C8A870", "4E6E8E", "8E6F3E", "2E5F4D", "A0473A", "667085"),
            style_profile=ReportStyleProfile.Editorial,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Business],
            id=ReportThemeVariantId.BusinessBlueProfessional,
            name="Blue Professional",
            page_bg="FDFAE7",
            paper_bg="FFFFFF",
            text="111111",
            muted="6B6B6B",
            subtle="F3F1E2",
            line="DFD9C7",
            accent="1E2BFA",
            accent_strong="10166F",
            accent_soft="ECEFFF",
            table_header_fill="10166F",
            table_header_text="FFFFFF",
            chart_colors=("1E2BFA", "111111", "0E7490", "17805B", "B7791F", "B94135", "6B6B6B", "4254B8"),
            module_colors=("1E2BFA", "0E7490", "17805B", "B7791F", "4254B8", "6B6B6B"),
            style_profile=ReportStyleProfile.Framed,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Business],
            id=ReportThemeVariantId.BusinessWarmMonochrome,
            name="Warm Monochrome",
            page_bg="FAF7EF",
            paper_bg="FFFFFF",
            text="1F2933",
            muted="6B7280",
            subtle="EFE8DA",
            line="D8D0C0",
            accent="4B5563",
            accent_strong="1F2933",
            accent_soft="F3EFE7",
            table_header_fill="1F2933",
            table_header_text="FFFFFF",
            chart_colors=("1F2933", "4B5563", "6B7280", "9CA3AF", "8A6A3D", "A33A2F", "2F6F4E", "315A75"),
            module_colors=("4B5563", "6B7280", "8A6A3D", "315A75", "2F6F4E", "A33A2F"),
            style_profile=ReportStyleProfile.Ledger,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Business],
            id=ReportThemeVariantId.BusinessCartesianNeutral,
            name="Cartesian Neutral",
            page_bg="EDE8E0",
            paper_bg="FFFDF8",
            text="1A1A1A",
            muted="5A5A5A",
            subtle="E2DBD1",
            line="B8B0A4",
            accent="8A8178",
            accent_strong="1A1A1A",
            accent_soft="F2EDE6",
            table_header_fill="1A1A1A",
            table_header_text="F7F2EA",
            chart_colors=("1A1A1A", "8A8178", "5A5A5A", "B8B0A4", "7A5B45", "315A75", "6D4A7E", "2F6F4E"),
            module_colors=("8A8178", "7A5B45", "315A75", "6D4A7E", "2F6F4E", "5A5A5A"),
            style_profile=ReportStyleProfile.Ledger,
        ),
    ),
    ReportThemeId.Risk: (
        with_module_colors(
            REPORT_THEMES[ReportThemeId.Risk],
            "8E2F3C", "A61B1B", "B7791F", "4E6E8E", "776A6A", "25795C",
            style_profile=ReportStyleProfile.Rail,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Risk],
            id=ReportThemeVariantId.RiskBurgundyAmber,
            name="Burgundy Risk",
            page_bg="FFF7ED",
            paper_bg="FFFFFF",
            text="2B1717",
            muted="6B5E57",
            subtle="FED7AA",
            line="E8B99A",
            accent="B91C1C",
            accent_strong="7F1D1D",
            accent_soft="FEECE2",
            table_header_fill="7F1D1D",
            table_header_text="FFFFFF",
            chart_colors=("B91C1C", "7F1D1D", "C4661F", "475569", "9A3412", "25795C", "6B7280", "A16207"),
            module_colors=("B91C1C", "C4661F", "9A3412", "475569", "A16207", "25795C"),
            style_profile=ReportStyleProfile.Rail,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Risk],
            id=ReportThemeVariantId.RiskRosewood,
            name="Rosewood Legal",
            page_bg="F9F1EF",
            paper_bg="FFFFFF",
            text="2A1E1F",
            muted="725F62",
            subtle="F1DEDA",
            line="DFC2BC",
            accent="9D3B45",
            accent_strong="5C1F28",
            accent_soft="F8E9EA",
            table_header_fill="5C1F28",
            table_header_text="FFFFFF",
            chart_colors=("9D3B45", "5C1F28", "BD6A5B", "8A6A3D", "5A6675", "2F6F4E", "776A6A", "A61B1B"),
            module_colors=("9D3B45", "BD6A5B", "8A6A3D", "5A6675", "A61B1B", "2F6F4E"),
            style_profile=ReportStyleProfile.Framed,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Risk],
            id=ReportThemeVariantId.RiskSlateRed,
            name="Slate Red",
            page_bg="F6F4F2",
            paper_bg="FFFFFF",
            text="232B35",
            muted="667085",
            subtle="F0E7E5",
            line="D7CBC8",
            accent="B5473C",
            accent_strong="52312D",
            accent_soft="F8EBE8",
            table_header_fill="52312D",
            table_header_text="FFFFFF",
            chart_colors=("B5473C", "52312D", "6B7280", "315A75", "B7791F", "2F6F4E", "8A8178", "A61B1B"),
            module_colors=("B5473C", "6B7280", "315A75", "B7791F", "A61B1B", "2F6F4E"),
            style_profile=ReportStyleProfile.Ledger,
        ),
    ),
    ReportThemeId.Bid: (
        with_module_colors(
            REPORT_THEMES[ReportThemeId.Bid],
            "16745B", "9A6A2F", "2F6F88", "7A8B76", "315A75", "A33A2F",
            style_profile=ReportStyleProfile.Ledger,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Bid],
            id=ReportThemeVariantId.BidSageTerracotta,
            name="Sage Terracotta",
            page_bg="F5F0E6",
            paper_bg="FFFFFF",
            text="243329",
            muted="65705F",
            subtle="DAD7CD",
            line="C6C4B8",
            accent="344E41",
            accent_strong="243329",
            accent_soft="EEF1EA",
            table_header_fill="243329",
            table_header_text="FFFFFF",
            chart_colors=("344E41", "A3B18A", "C4661F", "65705F", "7A6A50", "A33A2F", "2F6F88", "243329"),
            module_colors=("344E41", "A3B18A", "C4661F", "2F6F88", "7A6A50", "65705F"),
            style_profile=ReportStyleProfile.Ledger,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Bid],
            id=ReportThemeVariantId.BidTealSupply,
            name="Teal Supply",
            page_bg="F2F7F6",
            paper_bg="FFFFFF",
            text="112C2B",
            muted="58706D",
            subtle="E4F0EE",
            line="C6DEDA",
            accent="0F766E",
            accent_strong="134E4A",
            accent_soft="E7F5F3",
            table_header_fill="134E4A",
            table_header_text="FFFFFF",
            chart_colors=("0F766E", "134E4A", "2F6F88", "B7791F", "2F6F4E", "A33A2F", "64748B", "315A75"),
            module_colors=("0F766E", "2F6F88", "B7791F", "2F6F4E", "315A75", "64748B"),
            style_profile=ReportStyleProfile.Framed,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Bid],
            id=ReportThemeVariantId.BidOliveProcurement,
            name="Olive Procurement",
            page_bg="F6F4EA",
            paper_bg="FFFFFB",
            text="273222",
            muted="66705F",
            subtle="EEF0DE",
            line="D8D8BE",
            accent="6B7D2E",
            accent_strong="3E4B1D",
            accent_soft="F0F3E2",
            table_header_fill="3E4B1D",
            table_header_text="FFFFFB",
            chart_colors=("6B7D2E", "3E4B1D", "A36D2A", "2F6F88", "7A8B76", "A33A2F", "667085", "315A75"),
            module_colors=("6B7D2E", "A36D2A", "2F6F88", "7A8B76", "315A75", "667085"),
            style_profile=ReportStyleProfile.Rail,
        ),
    ),
    ReportThemeId.IntellectualProperty: (
        with_module_colors(
            REPORT_THEMES[ReportThemeId.IntellectualProperty],
            "4F46E5", "06B6D4", "047857", "B45309", "7C3AED", "667085",
            style_profile=ReportStyleProfile.Framed,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.IntellectualProperty],
            id=ReportThemeVariantId.IpCobaltResearch,
            name="Cobalt Research",
            page_bg="F8F7F2",
            paper_bg="FFFFFF",
            text="1E1B4B",
            muted="626679",
            subtle="E0E7FF",
            line="CBD5E1",
            accent="3730A3",
            accent_strong="1E1B4B",
            accent_soft="EEF2FF",
            table_header_fill="1E1B4B",
            table_header_text="FFFFFF",
            chart_colors=("3730A3", "1E1B4B", "0891B2", "047857", "A16207", "B42318", "64748B", "5560E5"),
            module_colors=("3730A3", "0891B2", "047857", "A16207", "5560E5", "64748B"),
            style_profile=ReportStyleProfile.Framed,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.IntellectualProperty],
            id=ReportThemeVariantId.IpVioletLab,
            name="Violet Lab",
            page_bg="F8F7FC",
            paper_bg="FFFFFF",
            text="251A3A",
            muted="686173",
            subtle="F0ECFA",
            line="DAD2ED",
            accent="6D4A9C",
            accent_strong="402A61",
            accent_soft="F3EEF9",
            table_header_fill="402A61",
            table_header_text="FFFFFF",
            chart_colors=("6D4A9C", "402A61", "4F46E5", "0891B2", "047857", "B45309", "64748B", "A16207"),
            module_colors=("6D4A9C", "4F46E5", "0891B2", "047857", "A16207", "64748B"),
            style_profile=ReportStyleProfile.Editorial,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.IntellectualProperty],
            id=ReportThemeVariantId.IpSlateCyan,
            name="Slate Cyan",
            page_bg="F3F7F8",
            paper_bg="FFFFFF",
            text="172A36",
            muted="667780",
            subtle="EAF3F5",
            line="CDDDE2",
            accent="0E7490",
            accent_strong="164E63",
            accent_soft="E7F5F8",
            table_header_fill="164E63",
            table_header_text="FFFFFF",
            chart_colors=("0E7490", "164E63", "4F46E5", "047857", "B45309", "B42318", "64748B", "315A75"),
            module_colors=("0E7490", "4F46E5", "047857", "B45309", "315A75", "64748B"),
            style_profile=ReportStyleProfile.Ledger,
        ),
    ),
    ReportThemeId.Equity: (
        with_module_colors(
            REPORT_THEMES[ReportThemeId.Equity],
            "2F6F4E", "A36D2A", "507D8C", "7A8B76", "315A75", "A33A2F",
            style_profile=ReportStyleProfile.Rail,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Equity],
            id=ReportThemeVariantId.EquityForestCapital,
            name="Forest Capital",
            page_bg="F2F5EF",
            paper_bg="FFFFFF",
            text="17251E",
            muted="637066",
            subtle="EAF1E6",
            line="CFDCCB",
            accent="1B6B4A",
            accent_strong="123D35",
            accent_soft="E7F2EC",
            table_header_fill="123D35",
            table_header_text="FFFFFF",
            chart_colors=("1B6B4A", "123D35", "A36D2A", "507D8C", "7A8B76", "A33A2F", "6B7280", "315A75"),
            module_colors=("1B6B4A", "A36D2A", "507D8C", "7A8B76", "315A75", "6B7280"),
            style_profile=ReportStyleProfile.Rail,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Equity],
            id=ReportThemeVariantId.EquityClayLedger,
            name="Clay Ledger",
            page_bg="F7F3EC",
            paper_bg="FFFFFF",
            text="1F2A24",
            muted="6A675E",
            subtle="EFE7DA",
            line="DACFBE",
            accent="8A6A3D",
            accent_strong="4B3821",
            accent_soft="F4EEE4",
            table_header_fill="4B3821",
            table_header_text="FFFFFF",
            chart_colors=("8A6A3D", "4B3821", "2F6F4E", "315A75", "7A8B76", "A33A2F", "6B7280", "A36D2A"),
            module_colors=("8A6A3D", "2F6F4E", "315A75", "7A8B76", "A36D2A", "6B7280"),
            style_profile=ReportStyleProfile.Ledger,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Equity],
            id=ReportThemeVariantId.EquityEmeraldGold,
            name="Emerald Gold",
            page_bg="F3F7F1",
            paper_bg="FFFFFF",
            text="11251D",
            muted="667066",
            subtle="E9F2E7",
            line="CADCC8",
            accent="047857",
            accent_strong="064E3B",
            accent_soft="ECFDF5",
            table_header_fill="064E3B",
            table_header_text="FFFFFF",
            chart_colors=("047857", "064E3B", "B7791F", "315A75", "7A8B76", "B42318", "667085", "2F6F4E"),
            module_colors=("047857", "B7791F", "315A75", "7A8B76", "2F6F4E", "667085"),
            style_profile=ReportStyleProfile.Framed,
        ),
    ),
    ReportThemeId.Executive: (
        with_module_colors(
            REPORT_THEMES[ReportThemeId.Executive],
            "315A75", "5B7C99", "0F766E", "84A59D", "B54708", "667085",
            style_profile=ReportStyleProfile.Editorial,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Executive],
            id=ReportThemeVariantId.ExecutiveSignalBoard,
            name="Signal Boardroom",
            page_bg="F0ECE3",
            paper_bg="FFFFFF",
            text="1C2644",
            muted="667085",
            subtle="F4F1EA",
            line="D8D0C4",
            accent="4E6E8E",
            accent_strong="1C2644",
            accent_soft="EDF2F5",
            table_header_fill="1C2644",
            table_header_text="F4EFE6",
            chart_colors=("4E6E8E", "1C2644", "C8A870", "2E5F4D", "8E6F3E", "A0473A", "667085", "232F55"),
            module_colors=("4E6E8E", "C8A870", "2E5F4D", "8E6F3E", "667085", "A0473A"),
            style_profile=ReportStyleProfile.Editorial,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Executive],
            id=ReportThemeVariantId.ExecutiveSteelTeal,
            name="Steel Teal",
            page_bg="F4F7F8",
            paper_bg="FFFFFF",
            text="182832",
            muted="63717A",
            subtle="EAF1F3",
            line="CCD9DE",
            accent="2F6F88",
            accent_strong="1E4C60",
            accent_soft="E9F3F6",
            table_header_fill="1E4C60",
            table_header_text="FFFFFF",
            chart_colors=("2F6F88", "1E4C60", "0F766E", "B54708", "667085", "315A75", "84A59D", "B42318"),
            module_colors=("2F6F88", "0F766E", "B54708", "315A75", "84A59D", "667085"),
            style_profile=ReportStyleProfile.Framed,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Executive],
            id=ReportThemeVariantId.ExecutiveWarmSlate,
            name="Warm Slate",
            page_bg="F6F4EF",
            paper_bg="FFFFFF",
            text="202A32",
            muted="6B6E72",
            subtle="EFEAE2",
            line="D8D1C5",
            accent="596B7A",
            accent_strong="28343D",
            accent_soft="EEF1F3",
            table_header_fill="28343D",
            table_header_text="FFFFFF",
            chart_colors=("596B7A", "28343D", "9A6A2F", "2F6F4E", "B54708", "315A75", "667085", "A33A2F"),
            module_colors=("596B7A", "9A6A2F", "2F6F4E", "315A75", "B54708", "667085"),
            style_profile=ReportStyleProfile.Ledger,
        ),
    ),
    ReportThemeId.Relation: (
        with_module_colors(
            REPORT_THEMES[ReportThemeId.Relation],
            "6D4A7E", "B7791F", "2D7A68", "315A75", "9A7891", "A33A2F",
            style_profile=ReportStyleProfile.Framed,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Relation],
            id=ReportThemeVariantId.RelationPlumNetwork,
            name="Plum Network",
            page_bg="FBF7FB",
            paper_bg="FFFFFF",
            text="3B2247",
            muted="6D6470",
            subtle="EADFF1",
            line="D9CBE2",
            accent="7C3AED",
            accent_strong="3B2247",
            accent_soft="F4ECF8",
            table_header_fill="3B2247",
            table_header_text="FFFFFF",
            chart_colors=("7C3AED", "3B2247", "A16207", "2D7A68", "315A75", "A33A2F", "6B7280", "9A7891"),
            module_colors=("7C3AED", "A16207", "2D7A68", "315A75", "9A7891", "6B7280"),
            style_profile=ReportStyleProfile.Framed,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Relation],
            id=ReportThemeVariantId.RelationAubergineGold,
            name="Aubergine Gold",
            page_bg="F8F4F7",
            paper_bg="FFFFFF",
            text="2D2033",
            muted="6D6470",
            subtle="F1E8EF",
            line="DDCCD8",
            accent="8A5A7A",
            accent_strong="4B2C42",
            accent_soft="F6EEF4",
            table_header_fill="4B2C42",
            table_header_text="FFFFFF",
            chart_colors=("8A5A7A", "4B2C42", "B7791F", "315A75", "2D7A68", "A33A2F", "6B7280", "9A7891"),
            module_colors=("8A5A7A", "B7791F", "315A75", "2D7A68", "9A7891", "6B7280"),
            style_profile=ReportStyleProfile.Editorial,
        ),
        replace(
            REPORT_THEMES[ReportThemeId.Relation],
            id=ReportThemeVariantId.RelationIndigo,
            name="Indigo Relation",
            page_bg="F7F7FB",
            paper_bg="FFFFFF",
            text="1F2444",
            muted="626679",
            subtle="EEF0FA",
            line="D8DAEA",
            accent="4F46E5",
            accent_strong="2F2A7B",
            accent_soft="EEF2FF",
            table_header_fill="2F2A7B",
            table_header_text="FFFFFF",
            chart_colors=("4F46E5", "2F2A7B", "6D4A7E", "2D7A68", "B7791F", "A33A2F", "667085", "315A75"),
            module_colors=("4F46E5", "6D4A7E", "2D7A68", "B7791F", "315A75", "667085"),
            style_profile=ReportStyleProfile.Rail,
        ),
    ),
    ReportThemeId.Dark: (
        with_module_colors(
            REPORT_THEMES[ReportThemeId.Dark],
            "C8A55A", "65A782", "E07A5F", "9AB0D3", "B6AFA1", "D7A84D",
        ),
    ),
}

REPORT_THEME_VARIANT_LOOKUP: dict[str, ReportTheme] = {
    theme.id: theme
    for variants in REPORT_THEME_VARIANTS.values()
    for theme in variants
}

REPORT_THEME_CLI_CHOICES = (ReportThemeId.Business,)


class ChartKind:
    Bar = "bar"
    Line = "line"
    Pie = "pie"


class TableChartRole:
    Distribution = "distribution"
    Ranking = "ranking"
    Trend = "trend"


class ModuleKind:
    Cover = "cover"
    Toc = "toc"
    Disclaimer = "disclaimer"
    Verification = "verification"
    DefaultSection = "default_section"
    DefaultTable = "default_table"
    EmptyState = "empty_state"
    EnterpriseSummary = "enterprise_summary"
    BusinessInfo = "business_info"
    ShareholderPeopleInvestment = "shareholder_people_investment"
    LegalRisk = "legal_risk"
    BusinessRisk = "business_risk"
    BusinessOperation = "business_operation"
    IntellectualProperty = "intellectual_property"
    NewsAnnouncement = "news_announcement"
    History = "history"
    RiskSummary = "risk_summary"
    LitigationItem = "litigation_item"
    RelatedRisk = "related_risk"
    NoticeInfo = "notice_info"
    BidInvestigation = "bid_investigation"
    BidRiskCheck = "bid_risk_check"
    ExecutiveBasicInfo = "executive_basic_info"
    RelatedEnterprise = "related_enterprise"
    Partner = "partner"
    PositionInvestmentControl = "position_investment_control"
    BeneficialOwnership = "beneficial_ownership"
    RelatedPartySheet = "related_party_sheet"


MODULE_KIND_LABELS = {
    ModuleKind.Cover: "封面",
    ModuleKind.Toc: "目录",
    ModuleKind.Disclaimer: "免责声明",
    ModuleKind.Verification: "验真信息",
    ModuleKind.DefaultSection: "报告章节",
    ModuleKind.DefaultTable: "数据表格",
    ModuleKind.EmptyState: "暂无数据",
    ModuleKind.EnterpriseSummary: "企业概要",
    ModuleKind.BusinessInfo: "工商信息",
    ModuleKind.ShareholderPeopleInvestment: "股东与投资",
    ModuleKind.LegalRisk: "法律风险",
    ModuleKind.BusinessRisk: "经营风险",
    ModuleKind.BusinessOperation: "经营信息",
    ModuleKind.IntellectualProperty: "知识产权",
    ModuleKind.NewsAnnouncement: "新闻公告",
    ModuleKind.History: "历史信息",
    ModuleKind.RiskSummary: "风险统计",
    ModuleKind.LitigationItem: "司法诉讼",
    ModuleKind.RelatedRisk: "关联风险",
    ModuleKind.NoticeInfo: "提示信息",
    ModuleKind.BidInvestigation: "背景调查",
    ModuleKind.BidRiskCheck: "风险核查",
    ModuleKind.ExecutiveBasicInfo: "人员基本信息",
    ModuleKind.RelatedEnterprise: "关联企业",
    ModuleKind.Partner: "合作伙伴",
    ModuleKind.PositionInvestmentControl: "任职投资控制",
    ModuleKind.BeneficialOwnership: "受益所有权",
    ModuleKind.RelatedPartySheet: "关联方关系",
}


REPORT_TEMPLATE_THEME_IDS = {
    ReportTemplate.EnterpriseCredit: ReportThemeId.Business,
    ReportTemplate.RiskScan: ReportThemeId.Risk,
    ReportTemplate.BidCredit: ReportThemeId.Bid,
    ReportTemplate.ExecutiveProfile: ReportThemeId.Executive,
    ReportTemplate.RelatedParty: ReportThemeId.Relation,
    ReportTemplate.Generic: ReportThemeId.Business,
}

MODULE_THEME_IDS = {
    ModuleKind.LegalRisk: ReportThemeId.Risk,
    ModuleKind.BusinessRisk: ReportThemeId.Risk,
    ModuleKind.RiskSummary: ReportThemeId.Risk,
    ModuleKind.LitigationItem: ReportThemeId.Risk,
    ModuleKind.RelatedRisk: ReportThemeId.Risk,
    ModuleKind.BidInvestigation: ReportThemeId.Bid,
    ModuleKind.BidRiskCheck: ReportThemeId.Bid,
    ModuleKind.IntellectualProperty: ReportThemeId.IntellectualProperty,
    ModuleKind.ShareholderPeopleInvestment: ReportThemeId.Equity,
    ModuleKind.PositionInvestmentControl: ReportThemeId.Equity,
    ModuleKind.BeneficialOwnership: ReportThemeId.Equity,
    ModuleKind.ExecutiveBasicInfo: ReportThemeId.Executive,
    ModuleKind.RelatedEnterprise: ReportThemeId.Executive,
    ModuleKind.Partner: ReportThemeId.Executive,
    ModuleKind.RelatedPartySheet: ReportThemeId.Relation,
}


def clean_hex(value: str) -> str:
    return value.strip().lstrip("#").upper()


def css_hex(value: str) -> str:
    return f"#{clean_hex(value)}"


def argb_hex(value: str) -> str:
    return f"FF{clean_hex(value)}"


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    normalized = clean_hex(value)
    if len(normalized) == 3:
        normalized = "".join(char * 2 for char in normalized)
    if len(normalized) != 6:
        return (0, 0, 0)
    return tuple(int(normalized[index : index + 2], 16) for index in range(0, 6, 2))


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "".join(f"{max(0, min(255, channel)):02X}" for channel in rgb)


def mix_hex(first: str, second: str, second_weight: float) -> str:
    ratio = max(0.0, min(1.0, second_weight))
    first_rgb = hex_to_rgb(first)
    second_rgb = hex_to_rgb(second)
    return rgb_to_hex(
        tuple(
            int(round(first_rgb[index] * (1 - ratio) + second_rgb[index] * ratio))
            for index in range(3)
        )
    )


def resolve_report_theme_family_id(model: ReportModel) -> str:
    template_theme_id = REPORT_TEMPLATE_THEME_IDS.get(model.template, ReportThemeId.Business)
    if model.template != ReportTemplate.Generic:
        return template_theme_id

    signature = compact_plain_text(" ".join([model.title, *(section.title for section in model.sections)]))
    if any(keyword in signature for keyword in ("风险扫描", "风险报告", "风险信息报告", "风险信息", "法律风险", "经营风险", "司法诉讼")):
        return ReportThemeId.Risk
    if any(keyword in signature for keyword in ("招投标", "投标", "中标", "供应链", "项目线索", "投资布局", "对外投资", "重点布局")):
        return ReportThemeId.Bid
    if any(keyword in signature for keyword in ("知识产权", "商标", "专利", "软著", "软件著作权", "作品著作权")):
        return ReportThemeId.IntellectualProperty
    if any(keyword in signature for keyword in ("关联方", "关联关系", "关联路径")):
        return ReportThemeId.Relation
    if any(keyword in signature for keyword in ("董监高", "任职", "高管", "法定代表人", "关联企业")):
        return ReportThemeId.Executive
    if any(keyword in signature for keyword in ("股权", "股东", "持股", "控股", "受益所有人")):
        return ReportThemeId.Equity

    module_theme_counts: dict[str, int] = {}
    for section in model.sections:
        theme_id = MODULE_THEME_IDS.get(section.kind)
        if theme_id:
            module_theme_counts[theme_id] = module_theme_counts.get(theme_id, 0) + 1
    if module_theme_counts:
        selected_theme_id = max(module_theme_counts.items(), key=lambda item: item[1])[0]
        return selected_theme_id

    return template_theme_id


def resolve_report_theme(
    model: ReportModel,
    requested_theme_id: str | None = None,
) -> ReportTheme:
    del model, requested_theme_id
    return REPORT_THEMES[ReportThemeId.Business]


MODULE_RISK_ACCENT_KINDS = {
    ModuleKind.LegalRisk,
    ModuleKind.BusinessRisk,
    ModuleKind.RiskSummary,
    ModuleKind.LitigationItem,
    ModuleKind.RelatedRisk,
}


def module_accent_color(theme: ReportTheme, section: ReportSection, section_index: int) -> str:
    del section
    del section_index
    return theme.accent


def chart_colors_with_accent(theme: ReportTheme, accent: str) -> tuple[str, ...]:
    normalized_accent = clean_hex(accent)
    rotated = [accent]
    rotated.extend(color for color in theme.chart_colors if clean_hex(color) != normalized_accent)
    return tuple(rotated)


def theme_with_module_accent(theme: ReportTheme, section: ReportSection, section_index: int) -> ReportTheme:
    accent = module_accent_color(theme, section, section_index)
    return replace(
        theme,
        accent=accent,
        accent_soft=mix_hex(theme.paper_bg, accent, 0.10),
        quote_bg=mix_hex(theme.paper_bg, accent, 0.07),
        chart_colors=chart_colors_with_accent(theme, accent),
    )


def office_theme(theme: ReportTheme) -> ReportTheme:
    if theme.id == ReportThemeId.Dark:
        return REPORT_THEMES[ReportThemeId.Business]
    return theme


def theme_css_variables(theme: ReportTheme) -> dict[str, str]:
    return {
        "page-bg": theme.page_bg,
        "paper-bg": theme.paper_bg,
        "text": theme.text,
        "muted": theme.muted,
        "subtle": theme.subtle,
        "line": theme.line,
        "accent": theme.accent,
        "accent-strong": theme.accent_strong,
        "accent-soft": theme.accent_soft,
        "brand": theme.brand,
        "risk": theme.risk,
        "risk-soft": theme.risk_soft,
        "success": theme.success,
        "success-soft": theme.success_soft,
        "warning": theme.warning,
        "table-header-fill": theme.table_header_fill,
        "table-header-text": theme.table_header_text,
        "quote-bg": theme.quote_bg,
        "code-bg": theme.code_bg,
    }


REPORT_STYLE_CSS_VARIABLES = {
    ReportStyleProfile.Classic: {
        "page-radius": "6px",
        "cover-min-height": "430px",
        "cover-copy-margin-top": "88px",
        "cover-title-size": "40px",
        "toc-padding": "22px 24px",
        "toc-radius": "4px",
        "toc-border-left-width": "5px",
        "section-margin-top": "26px",
        "section-padding": "0 0 22px 18px",
        "section-border": "0 solid transparent",
        "section-border-left-width": "4px",
        "section-border-bottom-width": "1px",
        "section-radius": "0",
        "section-bg": "transparent",
        "metric-padding": "12px",
        "metric-radius": "8px",
        "table-radius": "4px",
        "table-cell-padding": "9px 12px",
        "print-cover-min-height": "210mm",
        "print-cover-copy-margin-top": "46mm",
        "print-section-margin-top": "14pt",
        "print-section-padding": "0",
        "print-section-border": "0 solid transparent",
        "print-section-border-left-width": "0",
        "print-section-border-bottom-width": "0",
        "print-section-radius": "0",
        "print-section-bg": "transparent",
        "print-heading-border-bottom": "1px solid var(--line)",
        "print-heading-padding": "0 0 4pt",
    },
    ReportStyleProfile.Framed: {
        "page-radius": "8px",
        "cover-min-height": "410px",
        "cover-copy-margin-top": "76px",
        "cover-title-size": "38px",
        "toc-padding": "20px 22px",
        "toc-radius": "8px",
        "toc-border-left-width": "0",
        "section-margin-top": "24px",
        "section-padding": "18px 20px 20px",
        "section-border": "1px solid var(--line)",
        "section-border-left-width": "5px",
        "section-border-bottom-width": "1px",
        "section-radius": "8px",
        "section-bg": "var(--paper-bg)",
        "metric-padding": "13px",
        "metric-radius": "6px",
        "table-radius": "8px",
        "table-cell-padding": "9px 12px",
        "print-cover-min-height": "210mm",
        "print-cover-copy-margin-top": "43mm",
        "print-section-margin-top": "14pt",
        "print-section-padding": "9pt 10pt 10pt",
        "print-section-border": "0.7pt solid var(--line)",
        "print-section-border-left-width": "3pt",
        "print-section-border-bottom-width": "0.7pt",
        "print-section-radius": "4pt",
        "print-section-bg": "var(--paper-bg)",
        "print-heading-border-bottom": "0 solid transparent",
        "print-heading-padding": "0",
    },
    ReportStyleProfile.Ledger: {
        "page-radius": "3px",
        "cover-min-height": "360px",
        "cover-copy-margin-top": "64px",
        "cover-title-size": "36px",
        "toc-padding": "16px 18px",
        "toc-radius": "2px",
        "toc-border-left-width": "3px",
        "section-margin-top": "20px",
        "section-padding": "0 0 18px 14px",
        "section-border": "0 solid transparent",
        "section-border-left-width": "3px",
        "section-border-bottom-width": "1px",
        "section-radius": "0",
        "section-bg": "transparent",
        "metric-padding": "10px",
        "metric-radius": "4px",
        "table-radius": "2px",
        "table-cell-padding": "7px 10px",
        "print-cover-min-height": "196mm",
        "print-cover-copy-margin-top": "38mm",
        "print-section-margin-top": "11pt",
        "print-section-padding": "0",
        "print-section-border": "0 solid transparent",
        "print-section-border-left-width": "2pt",
        "print-section-border-bottom-width": "0.7pt",
        "print-section-radius": "0",
        "print-section-bg": "transparent",
        "print-heading-border-bottom": "0.7pt solid var(--line)",
        "print-heading-padding": "0 0 3pt",
    },
    ReportStyleProfile.Rail: {
        "page-radius": "5px",
        "cover-min-height": "400px",
        "cover-copy-margin-top": "80px",
        "cover-title-size": "39px",
        "toc-padding": "20px 24px",
        "toc-radius": "4px",
        "toc-border-left-width": "7px",
        "section-margin-top": "26px",
        "section-padding": "4px 0 24px 22px",
        "section-border": "0 solid transparent",
        "section-border-left-width": "6px",
        "section-border-bottom-width": "1px",
        "section-radius": "0",
        "section-bg": "transparent",
        "metric-padding": "12px",
        "metric-radius": "8px",
        "table-radius": "4px",
        "table-cell-padding": "9px 12px",
        "print-cover-min-height": "206mm",
        "print-cover-copy-margin-top": "43mm",
        "print-section-margin-top": "13pt",
        "print-section-padding": "0 0 0 8pt",
        "print-section-border": "0 solid transparent",
        "print-section-border-left-width": "2.6pt",
        "print-section-border-bottom-width": "0",
        "print-section-radius": "0",
        "print-section-bg": "transparent",
        "print-heading-border-bottom": "0 solid transparent",
        "print-heading-padding": "0 0 3pt",
    },
    ReportStyleProfile.Editorial: {
        "page-radius": "6px",
        "cover-min-height": "460px",
        "cover-copy-margin-top": "112px",
        "cover-title-size": "42px",
        "toc-padding": "22px 24px",
        "toc-radius": "8px",
        "toc-border-left-width": "0",
        "section-margin-top": "30px",
        "section-padding": "0 0 28px",
        "section-border": "0 solid transparent",
        "section-border-left-width": "0",
        "section-border-bottom-width": "1px",
        "section-radius": "0",
        "section-bg": "transparent",
        "metric-padding": "14px",
        "metric-radius": "8px",
        "table-radius": "6px",
        "table-cell-padding": "10px 12px",
        "print-cover-min-height": "214mm",
        "print-cover-copy-margin-top": "52mm",
        "print-section-margin-top": "17pt",
        "print-section-padding": "0",
        "print-section-border": "0 solid transparent",
        "print-section-border-left-width": "0",
        "print-section-border-bottom-width": "0.7pt",
        "print-section-radius": "0",
        "print-section-bg": "transparent",
        "print-heading-border-bottom": "0.7pt solid var(--line)",
        "print-heading-padding": "0 0 5pt",
    },
}


def report_style_css_variables(style_profile: str) -> dict[str, str]:
    return REPORT_STYLE_CSS_VARIABLES.get(style_profile, REPORT_STYLE_CSS_VARIABLES[ReportStyleProfile.Classic])


def build_theme_css(selector: str, theme: ReportTheme) -> str:
    variables = theme_css_variables(theme)
    style_variables = report_style_css_variables(theme.style_profile)
    lines = [f"{selector} {{"]
    if theme.id == ReportThemeId.Dark:
        lines.append("  color-scheme: dark;")
    else:
        lines.append("  color-scheme: light;")
    lines.extend(f"  --{name}: {css_hex(value)};" for name, value in variables.items())
    lines.extend(f"  --{name}: {value};" for name, value in style_variables.items())
    lines.append("  --shadow: 0 18px 44px rgba(18, 24, 38, 0.08);")
    lines.append('  --font-sans: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "Hiragino Sans GB", "Heiti SC", "Segoe UI", sans-serif;')
    lines.append('  --font-mono: "SFMono-Regular", "Cascadia Mono", "Consolas", monospace;')
    lines.append("}")
    return "\n".join(lines)


def inline_theme_style(theme: ReportTheme) -> str:
    variables = theme_css_variables(theme)
    names = ("accent", "accent-soft", "quote-bg")
    return "; ".join(f"--{name}: {css_hex(variables[name])}" for name in names)


@dataclass
class ReportMetric:
    label: str
    value: str
    tone: str = "neutral"


@dataclass
class ReportChart:
    title: str
    kind: str
    categories: list[str]
    values: list[float]
    unit: str = ""
    series_label: str = ""
    max_value: float | None = None


@dataclass
class ReportSection:
    title: str
    level: int
    kind: str
    blocks: list[Block] = field(default_factory=list)
    metrics: list[ReportMetric] = field(default_factory=list)
    charts: list[ReportChart] = field(default_factory=list)
    is_empty: bool = False


@dataclass
class ReportModel:
    title: str
    template: str
    blocks: list[Block]
    sections: list[ReportSection]
    metrics: list[ReportMetric] = field(default_factory=list)
    charts: list[ReportChart] = field(default_factory=list)


def read_input(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    return Path(path).read_text(encoding="utf-8")


def split_table_row(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    cells: list[str] = []
    current: list[str] = []
    escaped = False
    for char in stripped:
        if char == "\\" and not escaped:
            escaped = True
            current.append(char)
            continue
        if char == "|" and not escaped:
            cells.append("".join(current).strip())
            current = []
            continue
        escaped = False
        current.append(char)
    cells.append("".join(current).strip())
    return cells


def is_table_separator(line: str) -> bool:
    cells = split_table_row(line)
    if not cells:
        return False
    return all(re.fullmatch(r":?-{3,}:?", cell.strip()) for cell in cells)


def is_table_start(lines: list[str], index: int) -> bool:
    if index + 1 >= len(lines):
        return False
    return "|" in lines[index] and is_table_separator(lines[index + 1])


def is_block_start(lines: list[str], index: int) -> bool:
    line = lines[index]
    stripped = line.strip()
    if not stripped:
        return True
    if stripped.startswith("```") or stripped.startswith("~~~"):
        return True
    if re.match(r"#{1,6}\s+", stripped):
        return True
    if re.match(r"^([-*_])(?:\s*\1){2,}\s*$", stripped):
        return True
    if is_table_start(lines, index):
        return True
    if re.match(r"\s*(?:[-*+]|\d+[.)])\s+", line):
        return True
    if stripped.startswith(">"):
        return True
    return False


def parse_blocks(markdown_text: str) -> list[Block]:
    lines = markdown_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[Block] = []
    index = 0

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if not stripped:
            index += 1
            continue

        fence_match = re.match(r"^(```|~~~)\s*([A-Za-z0-9_-]+)?\s*$", stripped)
        if fence_match:
            fence = fence_match.group(1)
            language = fence_match.group(2) or ""
            index += 1
            code_lines: list[str] = []
            while index < len(lines) and not lines[index].strip().startswith(fence):
                code_lines.append(lines[index])
                index += 1
            if index < len(lines):
                index += 1
            blocks.append({"type": "code", "language": language, "text": "\n".join(code_lines)})
            continue

        heading_match = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", stripped)
        if heading_match:
            blocks.append(
                {
                    "type": "heading",
                    "level": len(heading_match.group(1)),
                    "text": heading_match.group(2).strip(),
                }
            )
            index += 1
            continue

        if re.match(r"^([-*_])(?:\s*\1){2,}\s*$", stripped):
            blocks.append({"type": "rule"})
            index += 1
            continue

        if is_table_start(lines, index):
            headers = split_table_row(lines[index])
            index += 2
            rows: list[list[str]] = []
            while index < len(lines) and lines[index].strip() and "|" in lines[index]:
                rows.append(split_table_row(lines[index]))
                index += 1
            blocks.append({"type": "table", "headers": headers, "rows": rows})
            continue

        list_match = re.match(r"\s*((?:[-*+])|\d+[.)])\s+(.+)", line)
        if list_match:
            ordered = bool(re.match(r"\d", list_match.group(1)))
            items: list[str] = []
            while index < len(lines):
                item_match = re.match(r"\s*((?:[-*+])|\d+[.)])\s+(.+)", lines[index])
                if not item_match:
                    break
                if bool(re.match(r"\d", item_match.group(1))) != ordered:
                    break
                item_parts = [item_match.group(2).strip()]
                index += 1
                while index < len(lines):
                    continuation = lines[index]
                    if not continuation.strip():
                        break
                    if is_block_start(lines, index):
                        break
                    if continuation.startswith(" ") or continuation.startswith("\t"):
                        item_parts.append(continuation.strip())
                        index += 1
                        continue
                    break
                items.append(" ".join(item_parts))
            blocks.append({"type": "list", "ordered": ordered, "items": items})
            continue

        if stripped.startswith(">"):
            quote_lines: list[str] = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quote_lines.append(re.sub(r"^\s*>\s?", "", lines[index]).strip())
                index += 1
            blocks.append({"type": "quote", "text": "\n".join(quote_lines)})
            continue

        paragraph_lines = [stripped]
        index += 1
        while index < len(lines) and not is_block_start(lines, index):
            paragraph_lines.append(lines[index].strip())
            index += 1
        blocks.append({"type": "paragraph", "text": " ".join(part for part in paragraph_lines if part)})

    return blocks


def render_inline(text: str) -> str:
    placeholders: dict[str, str] = {}

    def stash(value: str) -> str:
        key = f"@@QCCDOCINLINE{len(placeholders)}@@"
        placeholders[key] = value
        return key

    def replace_code(match: re.Match[str]) -> str:
        return stash(f"<code>{html.escape(match.group(1))}</code>")

    def replace_link(match: re.Match[str]) -> str:
        label = html.escape(match.group(1))
        href = match.group(2).strip()
        if not re.match(r"^(https?://|mailto:|#)", href):
            return html.escape(match.group(0))
        return stash(f'<a href="{html.escape(href, quote=True)}">{label}</a>')

    working = re.sub(r"`([^`]+)`", replace_code, text)
    working = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", replace_link, working)
    working = html.escape(working)
    working = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", working)
    working = re.sub(r"__([^_]+)__", r"<strong>\1</strong>", working)
    working = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", working)
    working = re.sub(r"(?<!_)_([^_\n]+)_(?!_)", r"<em>\1</em>", working)
    for key, value in placeholders.items():
        working = working.replace(html.escape(key), value)
    return working


def plain_inline_text(text: str) -> str:
    working = text
    working = re.sub(r"`([^`]+)`", r"\1", working)
    working = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r"\1", working)
    working = re.sub(r"\*\*([^*]+)\*\*", r"\1", working)
    working = re.sub(r"__([^_]+)__", r"\1", working)
    working = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"\1", working)
    working = re.sub(r"(?<!_)_([^_\n]+)_(?!_)", r"\1", working)
    return html.unescape(working).strip()


def has_ai_disclaimer(text: str) -> bool:
    normalized_text = re.sub(r"\s+", "", plain_inline_text(text))
    normalized_disclaimer = re.sub(r"\s+", "", AI_DISCLAIMER_TEXT)
    return normalized_disclaimer in normalized_text


def strip_trailing_ai_disclaimer(text: str) -> str:
    lines = text.rstrip().splitlines()

    def is_disclaimer_line(value: str) -> bool:
        stripped = re.sub(r"^\s*>\s?", "", value).strip()
        stripped = re.sub(r"^[*_`~\s]+|[*_`~\s]+$", "", stripped)
        return re.sub(r"\s+", "", plain_inline_text(stripped)) == re.sub(r"\s+", "", AI_DISCLAIMER_TEXT)

    while lines and not lines[-1].strip():
        lines.pop()
    if lines and is_disclaimer_line(lines[-1]):
        lines.pop()
        while lines and not lines[-1].strip():
            lines.pop()
        if lines and re.match(r"^([-*_])(?:\s*\1){2,}\s*$", lines[-1].strip()):
            lines.pop()
    return "\n".join(lines).rstrip()


def section_kind(title: str) -> str:
    normalized = re.sub(r"\s+", "", title)
    for kind, keywords in SPECIAL_SECTION_KEYWORDS.items():
        if any(keyword in normalized for keyword in keywords):
            return kind
    return "default"


def extract_title(blocks: list[Block], fallback: str | None) -> str:
    if fallback:
        return fallback
    for block in blocks:
        if block.get("type") == "heading" and block.get("level") == 1:
            return str(block.get("text") or "文档")
    for block in blocks:
        if block.get("type") == "paragraph":
            text = str(block.get("text") or "").strip()
            if text:
                return text[:48]
    return "文档"


def compact_plain_text(value: str) -> str:
    return re.sub(r"\s+", "", plain_inline_text(value))


def infer_document_layout(blocks: list[Block], title: str) -> str:
    title_signature = compact_plain_text(title)
    has_plain_title = any(keyword in title_signature for keyword in PLAIN_DOCUMENT_TITLE_KEYWORDS)
    has_report_title = any(keyword in title_signature for keyword in REPORT_DOCUMENT_TITLE_KEYWORDS)
    if has_plain_title and not has_report_title:
        return ReportLayout.Plain

    body_parts = [title]
    for block in blocks[:36]:
        body_parts.append(block_plain_text(block))
    body_signature = compact_plain_text("\n".join(body_parts))
    body_signal_count = sum(1 for keyword in PLAIN_DOCUMENT_BODY_KEYWORDS if keyword in body_signature)
    heading_signal_count = sum(
        1
        for block in blocks
        if block.get("type") == BlockType.Heading
        and any(keyword in compact_plain_text(str(block.get("text") or "")) for keyword in PLAIN_DOCUMENT_TITLE_KEYWORDS)
    )
    if not has_report_title and (body_signal_count >= 3 or (body_signal_count >= 2 and heading_signal_count >= 1)):
        return ReportLayout.Plain
    return ReportLayout.Report


def plain_document_theme(theme: ReportTheme) -> ReportTheme:
    return replace(
        theme,
        accent=theme.text,
        accent_strong=theme.text,
        accent_soft="F8FAFC",
        table_header_fill="F2F4F7",
        table_header_text=theme.text,
        quote_bg="FFFFFF",
    )


def light_table_theme(theme: ReportTheme) -> ReportTheme:
    return replace(
        theme,
        table_header_fill=theme.subtle,
        table_header_text=theme.text,
    )


def module_kind_label(kind: str) -> str:
    return MODULE_KIND_LABELS.get(kind, MODULE_KIND_LABELS[ModuleKind.DefaultSection])


def report_template_label(template: str) -> str:
    return {
        ReportTemplate.EnterpriseCredit: "企业信用报告",
        ReportTemplate.RiskScan: "风险扫描报告",
        ReportTemplate.BidCredit: "招投标信用报告",
        ReportTemplate.ExecutiveProfile: "董监高投资任职及风险报告",
        ReportTemplate.RelatedParty: "关联方认定报告",
        ReportTemplate.Generic: "企业报告",
    }.get(template, "企业报告")


def local_report_date() -> str:
    return dt.datetime.now().strftime("%Y年%m月%d日")


METRIC_RENDER_MODULES = {
    ModuleKind.RiskSummary,
}


def should_render_metrics(section: ReportSection) -> bool:
    return section.kind in METRIC_RENDER_MODULES and bool(section.metrics)


def is_empty_content_block(block: Block) -> bool:
    text = compact_plain_text(block_plain_text(block))
    if not text:
        return False
    return any(pattern in text for pattern in ("暂未查询到相关信息", "暂无数据", "无相关数据"))


def strip_section_prefix(title: str) -> str:
    text = plain_inline_text(title)
    text = re.sub(r"^\s*第?[一二三四五六七八九十百]+[章节篇部分、.．]\s*", "", text)
    text = re.sub(r"^\s*[一二三四五六七八九十百]+[、.．]\s*", "", text)
    text = re.sub(r"^\s*\d+(?:[.．]\d+)*[、.．)]?\s*", "", text)
    return text.strip() or plain_inline_text(title)


def is_front_matter_block(block: Block) -> bool:
    block_type = block.get("type")
    if block_type == BlockType.Rule:
        return True
    if block_type not in (BlockType.Paragraph, BlockType.Quote):
        return False
    text = compact_plain_text(block_plain_text(block))
    if not text:
        return True
    return any(compact_plain_text(keyword) in text for keyword in FRONT_MATTER_KEYWORDS)


def should_skip_report_body_block(block: Block) -> bool:
    if block.get("type") == BlockType.Rule:
        return True
    text = block_plain_text(block)
    return bool(text and has_ai_disclaimer(text))


def block_plain_text(block: Block) -> str:
    block_type = block.get("type")
    if block_type == BlockType.Heading or block_type == BlockType.Paragraph or block_type == BlockType.Quote:
        return plain_inline_text(str(block.get("text") or ""))
    if block_type == BlockType.List:
        return " ".join(plain_inline_text(str(item)) for item in block.get("items", []))
    if block_type == BlockType.Table:
        headers = " ".join(plain_inline_text(str(cell)) for cell in block.get("headers", []))
        rows = " ".join(
            plain_inline_text(str(cell))
            for row in block.get("rows", [])
            for cell in row
        )
        return f"{headers} {rows}".strip()
    if block_type == BlockType.Code:
        return str(block.get("text") or "").strip()
    return ""


def section_text_signature(title: str, blocks: list[Block]) -> str:
    text = " ".join([title, *(block_plain_text(block) for block in blocks)])
    return compact_plain_text(text)


def detect_report_template(title: str, blocks: list[Block]) -> str:
    title_signature = compact_plain_text(title)
    signature = section_text_signature(title, blocks)
    if "企业信用报告" in title_signature:
        return ReportTemplate.EnterpriseCredit
    if (
        "招投标信用报告" in title_signature
        or ("招投标" in title_signature and "信用报告" in title_signature)
        or ("背景调查结果" in signature and "风险核查" in signature)
    ):
        return ReportTemplate.BidCredit
    if "风险扫描" in signature or "风险报告" in title_signature or "风险信息报告" in title_signature \
        or ("自身风险" in signature and "关联风险" in signature):
        return ReportTemplate.RiskScan
    if "招投标信用报告" in title_signature or "投资布局" in title_signature \
        or ("对外投资" in title_signature and "布局" in title_signature) \
        or ("背景调查结果" in signature and "风险核查" in signature):
        return ReportTemplate.BidCredit
    if "董监高" in signature or ("投资任职" in signature and "关联企业" in signature):
        return ReportTemplate.ExecutiveProfile
    if "关联方认定" in signature or "关联方维度" in signature:
        return ReportTemplate.RelatedParty
    if "企业概要" in signature:
        return ReportTemplate.EnterpriseCredit
    return ReportTemplate.Generic


def detect_module_kind(title: str, blocks: list[Block]) -> str:
    signature = section_text_signature(title, blocks)
    if not signature:
        return ModuleKind.DefaultSection
    if "企业概要" in signature:
        return ModuleKind.EnterpriseSummary
    if (
        "工商信息" in signature
        or "营业执照信息" in signature
        or ("企业名称" in signature and "统一社会信用代码" in signature)
    ):
        return ModuleKind.BusinessInfo
    if any(keyword in signature for keyword in ("股东信息", "主要人员", "对外投资", "控制企业", "间接持股", "分支机构")):
        return ModuleKind.ShareholderPeopleInvestment
    if any(keyword in signature for keyword in ("法律风险", "司法案件", "裁判文书", "立案信息", "开庭公告", "被执行人", "失信被执行人")):
        return ModuleKind.LegalRisk
    if any(keyword in signature for keyword in ("经营风险", "行政处罚", "经营异常", "严重违法", "欠税公告")):
        return ModuleKind.BusinessRisk
    if any(keyword in signature for keyword in ("经营信息", "资质证书", "招投标", "招聘", "行政许可", "供应商", "客户")):
        return ModuleKind.BusinessOperation
    if any(keyword in signature for keyword in ("知识产权", "商标信息", "专利信息", "软件著作权", "作品著作权", "备案网站")):
        return ModuleKind.IntellectualProperty
    if any(keyword in signature for keyword in ("新闻公告", "新闻舆情", "企业公告", "相关公告", "政府公告")):
        return ModuleKind.NewsAnnouncement
    if "历史" in signature:
        return ModuleKind.History
    if any(keyword in signature for keyword in ("风险统计", "重要风险", "自身风险", "风险总量")):
        return ModuleKind.RiskSummary
    if any(keyword in signature for keyword in ("司法诉讼", "案件名称", "案号", "案件身份", "最新案件进程")):
        return ModuleKind.LitigationItem
    if "关联风险" in signature:
        return ModuleKind.RelatedRisk
    if "提示信息" in signature:
        return ModuleKind.NoticeInfo
    if "背景调查结果" in signature:
        return ModuleKind.BidInvestigation
    if "风险核查" in signature or ("调查项目" in signature and "调查结果" in signature):
        return ModuleKind.BidRiskCheck
    if "基本信息" in signature and ("姓名" in signature or "介绍" in signature):
        return ModuleKind.ExecutiveBasicInfo
    if "关联企业" in signature:
        return ModuleKind.RelatedEnterprise
    if "合作伙伴" in signature:
        return ModuleKind.Partner
    if any(keyword in signature for keyword in ("在外任职", "对外投资", "控制企业", "担任法定代表人")):
        return ModuleKind.PositionInvestmentControl
    if any(keyword in signature for keyword in ("最终受益人", "受益所有人", "受益自然人", "最终受益股份")):
        return ModuleKind.BeneficialOwnership
    if "关联方维度" in signature or "关联路径" in signature:
        return ModuleKind.RelatedPartySheet
    if any(keyword in signature for keyword in SPECIAL_SECTION_KEYWORDS["risk"]):
        return ModuleKind.LegalRisk
    non_heading_blocks = [block for block in blocks if block.get("type") != BlockType.Heading]
    if non_heading_blocks and all(block.get("type") == BlockType.Table for block in non_heading_blocks):
        return ModuleKind.DefaultTable
    return ModuleKind.DefaultSection


def is_empty_section(title: str, blocks: list[Block]) -> bool:
    signature = section_text_signature(title, blocks)
    if not signature:
        return False
    empty_patterns = (
        "暂未查询到相关信息",
        "不存在",
        "(0)",
        "暂无数据",
        "无相关数据",
    )
    has_table_rows = any(
        block.get("type") == BlockType.Table and len(block.get("rows", [])) > 0
        for block in blocks
    )
    if has_table_rows and "不存在" not in signature:
        return False
    return any(pattern in signature for pattern in empty_patterns)


def extract_report_metrics(blocks: list[Block]) -> list[ReportMetric]:
    metrics: list[ReportMetric] = []
    for block in blocks:
        if block.get("type") != BlockType.Table:
            continue
        headers = [plain_inline_text(str(cell)) for cell in block.get("headers", [])]
        rows = [[plain_inline_text(str(cell)) for cell in row] for row in block.get("rows", [])]
        if len(headers) >= 2 and rows and all(len(row) >= 2 for row in rows[:6]):
            for row in rows[:6]:
                label = row[0].strip()
                value = row[1].strip()
                if label and value and len(label) <= 16 and len(value) <= 24:
                    tone = "risk" if re.search(r"[1-9]\d*", value) and any(k in label for k in ("风险", "处罚", "案件")) else "neutral"
                    metrics.append(ReportMetric(label=label, value=value, tone=tone))
        if metrics:
            break
    return metrics[:6]


def normalize_chart_label(value: str) -> str:
    text = re.sub(r"\s+", " ", plain_inline_text(value)).strip()
    text = re.sub(r"^[（(]?\d+[）).、]\s*", "", text)
    return text or "未披露"


def parse_numeric_value(value: str) -> float | None:
    text = plain_inline_text(value)
    if not text:
        return None
    cleaned = text.replace(",", "").replace("，", "").replace(" ", "")
    match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not match:
        return None
    number = float(match.group(0))
    if "亿" in cleaned and "万" not in cleaned:
        number *= 10000
    return number


def is_year_label(value: str) -> bool:
    text = plain_inline_text(value)
    return bool(re.search(r"(?:19|20)\d{2}", text))


def chart_time_sort_key(value: str) -> tuple[int, int, int, str]:
    text = plain_inline_text(value)
    year_match = re.search(r"(19|20)\d{2}", text)
    if not year_match:
        return (9999, 99, 99, text)
    year = int(year_match.group(0))
    month = 1
    day = 1
    month_match = re.search(r"(?:19|20)\d{2}[-/.年](\d{1,2})", text)
    if month_match:
        month = int(month_match.group(1))
    quarter_match = re.search(r"[Qq季度第]\s*([1-4])", text)
    if quarter_match:
        month = (int(quarter_match.group(1)) - 1) * 3 + 1
    day_match = re.search(r"(?:19|20)\d{2}[-/.年]\d{1,2}[-/.月](\d{1,2})", text)
    if day_match:
        day = int(day_match.group(1))
    return (year, month, day, text)


def chart_kind_label(kind: str) -> str:
    return {
        ChartKind.Bar: "条形图",
        ChartKind.Line: "趋势图",
        ChartKind.Pie: "占比图",
    }.get(kind, "图表")


def table_block_data(block: Block) -> tuple[list[str], list[list[str]]]:
    headers = [plain_inline_text(str(cell)) for cell in block.get("headers", [])]
    rows = [
        [plain_inline_text(str(cell)) for cell in row]
        for row in block.get("rows", [])
    ]
    return headers, rows


def section_table_blocks(title: str, blocks: list[Block]) -> list[tuple[str, Block]]:
    table_blocks: list[tuple[str, Block]] = []
    current_title = title
    for block in blocks:
        if block.get("type") == BlockType.Heading:
            current_title = plain_inline_text(str(block.get("text") or "")) or current_title
            continue
        if block.get("type") == BlockType.Table:
            table_blocks.append((current_title, block))
    return table_blocks


def find_header_index(headers: list[str], keywords: tuple[str, ...]) -> int | None:
    normalized_headers = [compact_plain_text(header) for header in headers]
    for index, header in enumerate(normalized_headers):
        if any(keyword in header for keyword in keywords):
            return index
    return None


def find_shareholder_name_index(headers: list[str]) -> int | None:
    normalized_headers = [compact_plain_text(header) for header in headers]
    for index, header in enumerate(normalized_headers):
        if header in ("股东", "股东名称", "股东姓名"):
            return index
    for index, header in enumerate(normalized_headers):
        if "股东" in header and any(keyword in header for keyword in ("名称", "姓名", "名字")):
            return index
    return None


def find_shareholder_ratio_index(headers: list[str]) -> int | None:
    normalized_headers = [compact_plain_text(header) for header in headers]
    ratio_keywords = ("持股比例", "持股占比", "占股比例", "股份比例", "出资比例", "认缴比例")
    for index, header in enumerate(normalized_headers):
        if any(keyword in header for keyword in ratio_keywords):
            return index
    return None


def is_time_like_header(header: str) -> bool:
    normalized = compact_plain_text(header)
    return any(keyword in normalized for keyword in ("日期", "时间", "年份", "年度", "月份", "报告期"))


def find_generic_numeric_value_index(headers: list[str]) -> int | None:
    normalized_headers = [compact_plain_text(header) for header in headers]
    numeric_keywords = ("数量", "数值", "金额", "比例", "占比", "件数", "申请量", "总数", "个数")
    for index, header in enumerate(normalized_headers):
        if is_time_like_header(header):
            continue
        if any(keyword in header for keyword in numeric_keywords):
            return index
    return None


def table_column_count(headers: list[str], rows: list[list[str]]) -> int:
    return max([len(headers), *(len(row) for row in rows)] or [0])


def infer_table_label_index(headers: list[str], value_index: int) -> int | None:
    preferred_keywords = (
        "股东名称",
        "企业名称",
        "公司名称",
        "人员姓名",
        "姓名",
        "名称",
        "品牌",
        "状态",
        "类型",
        "分类",
        "类别",
        "项目",
        "指标",
        "年份",
        "年度",
        "地区",
        "行业",
    )
    skipped_keywords = ("序号", "编号", "排名")
    normalized_headers = [compact_plain_text(header) for header in headers]
    for index, header in enumerate(normalized_headers):
        if index == value_index:
            continue
        if any(keyword in header for keyword in preferred_keywords):
            return index
    for index, header in enumerate(normalized_headers):
        if index == value_index:
            continue
        if any(keyword in header for keyword in skipped_keywords):
            continue
        return index
    return None


def is_detail_like_table(headers: list[str], rows: list[list[str]]) -> bool:
    column_count = table_column_count(headers, rows)
    if column_count >= 5:
        return True
    detail_keywords = (
        "名称",
        "股东",
        "企业",
        "公司",
        "姓名",
        "日期",
        "金额",
        "标签",
        "备注",
        "地址",
        "代码",
        "案号",
    )
    detail_columns = sum(
        1
        for header in headers
        if any(keyword in compact_plain_text(header) for keyword in detail_keywords)
    )
    return column_count >= 4 and detail_columns >= 2


def classify_table_chart_role(
    table_title: str,
    headers: list[str],
    rows: list[list[str]],
    label_index: int,
    value_index: int,
    categories: list[str],
) -> str:
    header_signature = compact_plain_text(" ".join(headers))
    title_signature = compact_plain_text(table_title)
    label_header = compact_plain_text(headers[label_index]) if label_index < len(headers) else ""
    value_header = compact_plain_text(headers[value_index]) if value_index < len(headers) else ""
    if "趋势" in title_signature or all(is_year_label(category) for category in categories):
        return TableChartRole.Trend
    if find_header_index(headers, ("年份", "年度", "月份", "日期", "时间")) == label_index:
        return TableChartRole.Trend

    category_label = any(keyword in label_header for keyword in ("状态", "类型", "分类", "类别", "来源", "地区", "行业", "等级", "结果"))
    aggregate_metric = any(keyword in value_header for keyword in ("数量", "件数", "申请量", "总数", "个数", "占比", "比例"))
    distribution_title = any(keyword in title_signature or keyword in header_signature for keyword in ("分布", "构成", "占比", "统计"))
    if not is_detail_like_table(headers, rows) and aggregate_metric and (category_label or distribution_title):
        return TableChartRole.Distribution

    return TableChartRole.Ranking


def normalize_chart_items(
    categories: list[str],
    values: list[float],
    *,
    limit: int = 10,
    sort_desc: bool = False,
    sort_time: bool = False,
) -> tuple[list[str], list[float]]:
    pairs = [
        (normalize_chart_label(category), value)
        for category, value in zip(categories, values)
        if normalize_chart_label(category) and value is not None
    ]
    if sort_desc:
        pairs.sort(key=lambda item: abs(item[1]), reverse=True)
    elif sort_time and all(is_year_label(category) for category, _value in pairs):
        pairs.sort(key=lambda item: chart_time_sort_key(item[0]))
    pairs = pairs[:limit]
    return [category for category, _value in pairs], [value for _category, value in pairs]


def build_chart(
    title: str,
    kind: str,
    categories: list[str],
    values: list[float],
    *,
    unit: str = "",
    series_label: str = "",
    max_value: float | None = None,
    min_points: int = 2,
) -> ReportChart | None:
    categories, values = normalize_chart_items(
        categories,
        values,
        limit=10 if kind != ChartKind.Pie else 8,
        sort_desc=kind in (ChartKind.Bar, ChartKind.Pie),
        sort_time=kind == ChartKind.Line,
    )
    if len(categories) < min_points or len(values) < min_points:
        return None
    return ReportChart(
        title=title,
        kind=kind,
        categories=categories,
        values=values,
        unit=unit,
        series_label=series_label,
        max_value=max_value,
    )


def add_unique_chart(charts: list[ReportChart], chart: ReportChart | None) -> None:
    if chart is None:
        return
    signature = (
        chart.title,
        chart.kind,
        tuple(chart.categories),
        tuple(round(value, 4) for value in chart.values),
    )
    for existing in charts:
        existing_signature = (
            existing.title,
            existing.kind,
            tuple(existing.categories),
            tuple(round(value, 4) for value in existing.values),
        )
        if existing_signature == signature:
            return
    charts.append(chart)


def extract_shareholder_charts(title: str, blocks: list[Block]) -> list[ReportChart]:
    charts: list[ReportChart] = []
    for table_title, block in section_table_blocks(title, blocks):
        headers, rows = table_block_data(block)
        name_index = find_shareholder_name_index(headers)
        ratio_index = find_shareholder_ratio_index(headers)
        if name_index is None or ratio_index is None or name_index == ratio_index:
            continue
        categories: list[str] = []
        values: list[float] = []
        for row in rows:
            if name_index >= len(row) or ratio_index >= len(row):
                continue
            value = parse_numeric_value(row[ratio_index])
            if value is None:
                continue
            categories.append(row[name_index])
            values.append(value)
        add_unique_chart(
            charts,
            build_chart("股东持股比例", ChartKind.Bar, categories, values, unit="%", min_points=2),
        )
    return charts


FINANCIAL_CHART_METRICS: tuple[tuple[str, str, str], ...] = (
    ("营业收入", "万元", ChartKind.Line),
    ("净利润", "万元", ChartKind.Line),
    ("总资产", "万元", ChartKind.Line),
    ("净资产", "万元", ChartKind.Line),
    ("净利率", "%", ChartKind.Line),
    ("毛利率", "%", ChartKind.Line),
)


def financial_metric_definition(label: str) -> tuple[str, str, str] | None:
    compact = compact_plain_text(label)
    for keyword, unit, kind in FINANCIAL_CHART_METRICS:
        if keyword in compact:
            return keyword, unit, kind
    return None


def extract_financial_charts(title: str, blocks: list[Block]) -> list[ReportChart]:
    charts: list[ReportChart] = []
    for table_title, block in section_table_blocks(title, blocks):
        table_signature = compact_plain_text(f"{table_title} {block_plain_text(block)}")
        if not any(keyword in table_signature for keyword, _unit, _kind in FINANCIAL_CHART_METRICS):
            continue
        headers, rows = table_block_data(block)
        year_index = find_header_index(headers, ("年份", "年度", "报告期", "日期"))
        if year_index is not None:
            for header_index, header in enumerate(headers):
                if header_index == year_index:
                    continue
                metric = financial_metric_definition(header)
                if metric is None:
                    continue
                metric_label, unit, kind = metric
                categories: list[str] = []
                values: list[float] = []
                for row in rows:
                    if year_index >= len(row) or header_index >= len(row):
                        continue
                    value = parse_numeric_value(row[header_index])
                    if value is None:
                        continue
                    categories.append(row[year_index])
                    values.append(value)
                add_unique_chart(
                    charts,
                    build_chart(f"{metric_label}趋势", kind, categories, values, unit=unit, min_points=2),
                )
        year_columns = [(index, header) for index, header in enumerate(headers) if is_year_label(header)]
        if len(year_columns) >= 2:
            metric_index = find_header_index(headers, ("项目", "指标", "科目", "名称")) or 0
            for row in rows:
                if metric_index >= len(row):
                    continue
                metric = financial_metric_definition(row[metric_index])
                if metric is None:
                    continue
                metric_label, unit, kind = metric
                categories: list[str] = []
                values: list[float] = []
                for column_index, year_label in year_columns:
                    if column_index >= len(row):
                        continue
                    value = parse_numeric_value(row[column_index])
                    if value is None:
                        continue
                    categories.append(year_label)
                    values.append(value)
                add_unique_chart(
                    charts,
                    build_chart(f"{metric_label}趋势", kind, categories, values, unit=unit, min_points=2),
                )
    return charts[:6]


def count_distribution(rows: list[list[str]], category_index: int) -> tuple[list[str], list[float]]:
    counts: dict[str, float] = {}
    for row in rows:
        if category_index >= len(row):
            continue
        label = normalize_chart_label(row[category_index])
        if not label or label == "未披露":
            continue
        counts[label] = counts.get(label, 0) + 1
    pairs = sorted(counts.items(), key=lambda item: item[1], reverse=True)
    return [label for label, _value in pairs], [value for _label, value in pairs]


def extract_category_quantity_chart(
    title: str,
    kind: str,
    headers: list[str],
    rows: list[list[str]],
    category_keywords: tuple[str, ...],
    *,
    chart_kind: str,
    unit: str = "件",
) -> ReportChart | None:
    category_index = find_header_index(headers, category_keywords)
    if category_index is None:
        return None
    quantity_index = find_header_index(headers, ("数量", "件数", "申请量", "总数", "个数"))
    categories: list[str] = []
    values: list[float] = []
    if quantity_index is not None:
        for row in rows:
            if category_index >= len(row) or quantity_index >= len(row):
                continue
            value = parse_numeric_value(row[quantity_index])
            if value is None:
                continue
            categories.append(row[category_index])
            values.append(value)
    else:
        categories, values = count_distribution(rows, category_index)
    return build_chart(title, chart_kind, categories, values, unit=unit, min_points=2)


def extract_ip_charts(title: str, blocks: list[Block]) -> list[ReportChart]:
    charts: list[ReportChart] = []
    for table_title, block in section_table_blocks(title, blocks):
        headers, rows = table_block_data(block)
        table_signature = compact_plain_text(f"{title} {table_title} {block_plain_text(block)}")
        is_trademark = "商标" in table_signature
        is_patent = "专利" in table_signature
        if not (is_trademark or is_patent or "知识产权" in table_signature):
            continue
        prefix = "商标" if is_trademark or not is_patent else "专利"
        year_index = find_header_index(headers, ("年份", "年度", "申请年份", "申请年"))
        quantity_index = find_header_index(headers, ("数量", "件数", "申请量", "总数", "个数"))
        if year_index is not None and quantity_index is not None:
            categories: list[str] = []
            values: list[float] = []
            for row in rows:
                if year_index >= len(row) or quantity_index >= len(row):
                    continue
                value = parse_numeric_value(row[quantity_index])
                if value is None:
                    continue
                categories.append(row[year_index])
                values.append(value)
            add_unique_chart(
                charts,
                build_chart(f"{prefix}申请年份趋势", ChartKind.Line, categories, values, unit="件", min_points=2),
            )
        if is_trademark or "商标" in compact_plain_text(table_title):
            add_unique_chart(
                charts,
                extract_category_quantity_chart(
                    "商标国际分类分布",
                    "商标",
                    headers,
                    rows,
                    ("国际分类", "类别", "分类"),
                    chart_kind=ChartKind.Pie,
                    unit="件",
                ),
            )
            add_unique_chart(
                charts,
                extract_category_quantity_chart(
                    "商标法律状态分布",
                    "商标",
                    headers,
                    rows,
                    ("法律状态", "状态"),
                    chart_kind=ChartKind.Pie,
                    unit="件",
                ),
            )
        if is_patent or "专利" in compact_plain_text(table_title):
            add_unique_chart(
                charts,
                extract_category_quantity_chart(
                    "专利类型分布",
                    "专利",
                    headers,
                    rows,
                    ("专利类型", "类型", "种类"),
                    chart_kind=ChartKind.Pie,
                    unit="件",
                ),
            )
            add_unique_chart(
                charts,
                extract_category_quantity_chart(
                    "专利法律状态分布",
                    "专利",
                    headers,
                    rows,
                    ("法律状态", "状态"),
                    chart_kind=ChartKind.Pie,
                    unit="件",
                ),
            )
    return charts[:8]


def extract_generic_numeric_charts(title: str, kind: str, blocks: list[Block]) -> list[ReportChart]:
    charts: list[ReportChart] = []
    for table_title, block in section_table_blocks(title, blocks):
        headers, rows = table_block_data(block)
        table_signature = compact_plain_text(f"{title} {table_title} {' '.join(headers)}")
        if not any(keyword in table_signature for keyword in ("趋势", "分布", "占比", "比例", "统计")):
            continue
        if len(headers) < 2:
            continue
        value_index = find_generic_numeric_value_index(headers)
        if value_index is None:
            continue
        label_index = infer_table_label_index(headers, value_index)
        if label_index is None or label_index == value_index:
            continue
        categories: list[str] = []
        values: list[float] = []
        for row in rows:
            if label_index >= len(row) or value_index >= len(row):
                continue
            value = parse_numeric_value(row[value_index])
            if value is None:
                continue
            categories.append(row[label_index])
            values.append(value)
        chart_role = classify_table_chart_role(table_title, headers, rows, label_index, value_index, categories)
        if chart_role == TableChartRole.Trend:
            chart_kind = ChartKind.Line
        elif chart_role == TableChartRole.Distribution:
            chart_kind = ChartKind.Pie
        else:
            chart_kind = ChartKind.Bar
        add_unique_chart(
            charts,
            build_chart(f"{strip_section_prefix(table_title)}图表", chart_kind, categories, values, min_points=2),
        )
    return charts[:2] if kind in (ModuleKind.DefaultSection, ModuleKind.DefaultTable) else charts[:3]


def extract_section_charts(title: str, kind: str, blocks: list[Block]) -> list[ReportChart]:
    charts: list[ReportChart] = []
    if kind == ModuleKind.ShareholderPeopleInvestment:
        for chart in extract_shareholder_charts(title, blocks):
            add_unique_chart(charts, chart)
    if any(keyword in section_text_signature(title, blocks) for keyword in ("财务", "营业收入", "净利润", "总资产", "净资产", "毛利率", "净利率")):
        for chart in extract_financial_charts(title, blocks):
            add_unique_chart(charts, chart)
    section_signature = section_text_signature(title, blocks)
    if kind == ModuleKind.IntellectualProperty or any(keyword in section_signature for keyword in ("知识产权", "商标", "专利")):
        for chart in extract_ip_charts(title, blocks):
            add_unique_chart(charts, chart)
    if kind in (
        ModuleKind.DefaultSection,
        ModuleKind.DefaultTable,
        ModuleKind.RiskSummary,
        ModuleKind.BusinessOperation,
        ModuleKind.LegalRisk,
        ModuleKind.BusinessRisk,
    ):
        for chart in extract_generic_numeric_charts(title, kind, blocks):
            add_unique_chart(charts, chart)
    return charts[:10]


def build_report_sections(blocks: list[Block]) -> list[ReportSection]:
    sections: list[ReportSection] = []
    current: ReportSection | None = None
    skipped_first_h1 = False

    for block in blocks:
        if should_skip_report_body_block(block):
            continue
        if block.get("type") == BlockType.Heading:
            level = int(block.get("level", 2))
            title = plain_inline_text(str(block.get("text") or ""))
            if level == 1 and not skipped_first_h1:
                skipped_first_h1 = True
                continue
            if level <= 2:
                if current:
                    current.kind = detect_module_kind(current.title, current.blocks)
                    current.is_empty = is_empty_section(current.title, current.blocks)
                    current.metrics = extract_report_metrics(current.blocks)
                    current.charts = extract_section_charts(current.title, current.kind, current.blocks)
                    sections.append(current)
                current = ReportSection(title=title, level=level, kind=ModuleKind.DefaultSection, blocks=[block])
                continue
        if current is None:
            if is_front_matter_block(block):
                continue
            current = ReportSection(title="报告摘要", level=2, kind=ModuleKind.DefaultSection, blocks=[])
        current.blocks.append(block)

    if current:
        current.kind = detect_module_kind(current.title, current.blocks)
        current.is_empty = is_empty_section(current.title, current.blocks)
        current.metrics = extract_report_metrics(current.blocks)
        current.charts = extract_section_charts(current.title, current.kind, current.blocks)
        sections.append(current)

    return sections


def build_report_model_from_blocks(blocks: list[Block], title_override: str | None) -> ReportModel:
    title = extract_title(blocks, title_override)
    sections = build_report_sections(blocks)
    template = detect_report_template(title, blocks)
    metrics = extract_report_metrics(blocks)
    charts = [chart for section in sections for chart in section.charts]
    return ReportModel(title=title, template=template, blocks=blocks, sections=sections, metrics=metrics, charts=charts)


def build_report_model(markdown_text: str, title_override: str | None) -> ReportModel:
    return build_report_model_from_blocks(parse_blocks(markdown_text), title_override)


def render_table(block: Block) -> str:
    headers = [str(cell) for cell in block.get("headers", [])]
    rows = [[str(cell) for cell in row] for row in block.get("rows", [])]
    column_count = max([len(headers), *(len(row) for row in rows)] or [0])
    header_html = "".join(f"<th>{render_inline(cell)}</th>" for cell in headers)
    row_html: list[str] = []
    for row in rows:
        padded = row + [""] * (column_count - len(row))
        row_html.append("<tr>" + "".join(f"<td>{render_inline(cell)}</td>" for cell in padded) + "</tr>")
    return (
        '<div class="table-wrap">'
        "<table>"
        f"<thead><tr>{header_html}</tr></thead>"
        f"<tbody>{''.join(row_html)}</tbody>"
        "</table>"
        "</div>"
    )


def render_heading(block: Block, heading_id: str | None = None, section_number: int | None = None) -> str:
    level = int(block.get("level", 2))
    text = render_inline(str(block.get("text") or ""))
    id_attr = f' id="{html.escape(heading_id, quote=True)}"' if heading_id else ""
    return f"<h{level}{id_attr}>{text}</h{level}>"


def render_block(block: Block) -> str:
    block_type = block.get("type")
    if block_type == "heading":
        return render_heading(block)
    if block_type == "paragraph":
        return f'<p>{render_inline(str(block.get("text") or ""))}</p>'
    if block_type == "quote":
        text = "<br>".join(render_inline(part) for part in str(block.get("text") or "").split("\n"))
        return f"<blockquote>{text}</blockquote>"
    if block_type == "list":
        tag = "ol" if block.get("ordered") else "ul"
        items = "".join(f"<li>{render_inline(str(item))}</li>" for item in block.get("items", []))
        return f"<{tag}>{items}</{tag}>"
    if block_type == "table":
        return render_table(block)
    if block_type == "code":
        language = html.escape(str(block.get("language") or "text"))
        code = html.escape(str(block.get("text") or ""))
        return f'<pre data-language="{language}"><code>{code}</code></pre>'
    if block_type == "rule":
        return "<hr>"
    return ""


def render_toc(model: ReportModel) -> str:
    items: list[str] = []
    for section_index, section in enumerate(model.sections, start=1):
        text = render_inline(strip_section_prefix(section.title))
        items.append(f'<li><a href="#section-{section_index}">{text}</a></li>')
    if len(items) < 2:
        return ""
    label = "目录" if contains_cjk(model.title) else "Contents"
    return (
        '<nav class="toc" aria-label="Document sections">'
        f"<h2>{html.escape(label)}</h2>"
        f"<ol>{''.join(items)}</ol>"
        "</nav>"
    )


def render_metric_cards(metrics: list[ReportMetric]) -> str:
    if not metrics:
        return ""
    cards = []
    for metric in metrics[:6]:
        cards.append(
            '<div class="metric-card">'
            f'<span>{html.escape(metric.label)}</span>'
            f'<strong class="tone-{html.escape(metric.tone)}">{html.escape(metric.value)}</strong>'
            '</div>'
        )
    return f'<div class="metric-grid">{"".join(cards)}</div>'


CHART_COLORS = REPORT_THEMES[ReportThemeId.Business].chart_colors


def chart_svg_size(chart: ReportChart) -> tuple[int, int]:
    if chart.kind == ChartKind.Bar:
        return 760, max(260, 112 + len(chart.categories) * 36)
    if chart.kind == ChartKind.Pie:
        return 760, 330
    return 760, 310


def chart_value_text(value: float, unit: str = "") -> str:
    if abs(value) >= 1000:
        text = f"{value:,.0f}"
    elif abs(value) >= 100:
        text = f"{value:.0f}"
    elif abs(value) >= 10:
        text = f"{value:.1f}".rstrip("0").rstrip(".")
    else:
        text = f"{value:.2f}".rstrip("0").rstrip(".")
    return f"{text}{unit}" if unit else text


def svg_text(value: str) -> str:
    return html.escape(plain_inline_text(value))


def truncate_chart_label(value: str, max_chars: int) -> str:
    text = normalize_chart_label(value)
    if len(text) <= max_chars:
        return text
    return text[: max(1, max_chars - 1)].rstrip() + "…"


def svg_bar_chart(chart: ReportChart, width: int, height: int, theme: ReportTheme) -> str:
    values = chart.values
    min_value = min(0.0, *(values or [0.0]))
    max_value = max(0.0, *(values or [0.0]))
    if math.isclose(min_value, max_value):
        max_value = min_value + 1
    plot_x = 236
    plot_y = 62
    plot_w = width - plot_x - 96
    row_h = 34
    zero_x = plot_x + (0 - min_value) / (max_value - min_value) * plot_w
    shapes = [
        f'<line x1="{plot_x}" y1="{plot_y - 10}" x2="{plot_x + plot_w}" y2="{plot_y - 10}" stroke="{css_hex(theme.line)}" stroke-width="1"/>',
        f'<line x1="{zero_x:.1f}" y1="{plot_y - 18}" x2="{zero_x:.1f}" y2="{height - 40}" stroke="{css_hex(theme.line)}" stroke-width="1"/>',
    ]
    for index, (category, value) in enumerate(zip(chart.categories, values)):
        y = plot_y + index * row_h
        value_x = plot_x + (value - min_value) / (max_value - min_value) * plot_w
        bar_x = min(zero_x, value_x)
        bar_w = max(abs(value_x - zero_x), 3)
        color = css_hex(theme.risk) if value < 0 else css_hex(theme.chart_colors[index % len(theme.chart_colors)])
        shapes.append(
            f'<text x="{plot_x - 14}" y="{y + 17}" fill="{css_hex(theme.muted)}" font-size="12" text-anchor="end">{svg_text(truncate_chart_label(category, 18))}</text>'
        )
        shapes.append(
            f'<rect x="{bar_x:.1f}" y="{y}" width="{bar_w:.1f}" height="20" rx="3" fill="{color}"/>'
        )
        label_x = value_x + 8 if value >= 0 else value_x - 8
        anchor = "start" if value >= 0 else "end"
        shapes.append(
            f'<text x="{label_x:.1f}" y="{y + 15}" fill="{css_hex(theme.text)}" font-size="12" text-anchor="{anchor}" font-weight="700">{svg_text(chart_value_text(value, chart.unit))}</text>'
        )
    return "".join(shapes)


def svg_line_chart(chart: ReportChart, width: int, height: int, theme: ReportTheme) -> str:
    values = chart.values
    min_value = min(values or [0.0])
    max_value = max(values or [0.0])
    if math.isclose(min_value, max_value):
        padding = abs(max_value) * 0.1 or 1
        min_value -= padding
        max_value += padding
    else:
        padding = (max_value - min_value) * 0.12
        min_value -= padding
        max_value += padding
    left = 70
    right = 38
    top = 54
    bottom = 58
    plot_w = width - left - right
    plot_h = height - top - bottom
    points: list[tuple[float, float]] = []
    count = max(len(values), 1)
    for index, value in enumerate(values):
        x = left + (plot_w * index / max(count - 1, 1))
        y = top + (max_value - value) / (max_value - min_value) * plot_h
        points.append((x, y))
    path = " ".join(("M" if index == 0 else "L") + f"{x:.1f},{y:.1f}" for index, (x, y) in enumerate(points))
    shapes = [
        f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top + plot_h}" stroke="{css_hex(theme.line)}" stroke-width="1"/>',
        f'<line x1="{left}" y1="{top + plot_h}" x2="{left + plot_w}" y2="{top + plot_h}" stroke="{css_hex(theme.line)}" stroke-width="1"/>',
        f'<text x="{left}" y="{top - 12}" fill="{css_hex(theme.muted)}" font-size="12">{svg_text(chart_value_text(max(chart.values), chart.unit))}</text>',
        f'<text x="{left}" y="{top + plot_h + 32}" fill="{css_hex(theme.muted)}" font-size="12">{svg_text(chart_value_text(min(chart.values), chart.unit))}</text>',
        f'<path d="{path}" fill="none" stroke="{css_hex(theme.accent)}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>',
    ]
    for index, (point, category, value) in enumerate(zip(points, chart.categories, values)):
        x, y = point
        shapes.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="{css_hex(theme.accent)}" stroke="#FFFFFF" stroke-width="2"/>')
        if len(chart.categories) <= 10 or index % 2 == 0:
            shapes.append(
                f'<text x="{x:.1f}" y="{top + plot_h + 22}" fill="{css_hex(theme.muted)}" font-size="12" text-anchor="middle">{svg_text(truncate_chart_label(category, 8))}</text>'
            )
        shapes.append(
            f'<text x="{x:.1f}" y="{max(top + 12, y - 10):.1f}" fill="{css_hex(theme.text)}" font-size="11" text-anchor="middle" font-weight="700">{svg_text(chart_value_text(value, chart.unit))}</text>'
        )
    return "".join(shapes)


def pie_point(cx: float, cy: float, radius: float, angle: float) -> tuple[float, float]:
    radians = math.radians(angle)
    return cx + radius * math.cos(radians), cy + radius * math.sin(radians)


def svg_pie_chart(chart: ReportChart, width: int, height: int, theme: ReportTheme) -> str:
    total = sum(value for value in chart.values if value > 0)
    if total <= 0:
        return ""
    cx = 180
    cy = 178
    radius = 96
    start_angle = -90.0
    shapes: list[str] = []
    for index, (category, value) in enumerate(zip(chart.categories, chart.values)):
        if value <= 0:
            continue
        color = css_hex(theme.chart_colors[index % len(theme.chart_colors)])
        angle = value / total * 360
        end_angle = start_angle + angle
        if angle >= 359.99:
            shapes.append(f'<circle cx="{cx}" cy="{cy}" r="{radius}" fill="{color}"/>')
        else:
            start_x, start_y = pie_point(cx, cy, radius, start_angle)
            end_x, end_y = pie_point(cx, cy, radius, end_angle)
            large_arc = 1 if angle > 180 else 0
            shapes.append(
                f'<path d="M {cx:.1f},{cy:.1f} L {start_x:.1f},{start_y:.1f} A {radius},{radius} 0 {large_arc} 1 {end_x:.1f},{end_y:.1f} Z" fill="{color}" stroke="#FFFFFF" stroke-width="2"/>'
            )
        start_angle = end_angle
    legend_x = 340
    legend_y = 82
    for index, (category, value) in enumerate(zip(chart.categories, chart.values)):
        y = legend_y + index * 28
        percent = value / total * 100 if total else 0
        color = css_hex(theme.chart_colors[index % len(theme.chart_colors)])
        shapes.append(f'<rect x="{legend_x}" y="{y - 12}" width="12" height="12" rx="2" fill="{color}"/>')
        shapes.append(
            f'<text x="{legend_x + 20}" y="{y}" fill="{css_hex(theme.text)}" font-size="13">{svg_text(truncate_chart_label(category, 22))}</text>'
        )
        shapes.append(
            f'<text x="{width - 36}" y="{y}" fill="{css_hex(theme.muted)}" font-size="12" text-anchor="end">{percent:.1f}% / {svg_text(chart_value_text(value, chart.unit))}</text>'
        )
    return "".join(shapes)


def render_chart_svg(chart: ReportChart, theme: ReportTheme | None = None) -> str:
    theme = theme or REPORT_THEMES[ReportThemeId.Business]
    width, height = chart_svg_size(chart)
    if chart.kind == ChartKind.Bar:
        body = svg_bar_chart(chart, width, height, theme)
    elif chart.kind == ChartKind.Pie:
        body = svg_pie_chart(chart, width, height, theme)
    else:
        body = svg_line_chart(chart, width, height, theme)
    subtitle = chart.series_label or chart_kind_label(chart.kind)
    return (
        f'<svg class="report-chart-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(chart.title, quote=True)}" style="font-family: Microsoft YaHei, Arial, sans-serif;">'
        f'<rect x="0.5" y="0.5" width="{width - 1}" height="{height - 1}" rx="8" fill="{css_hex(theme.paper_bg)}" stroke="{css_hex(theme.line)}"/>'
        f'<text x="24" y="32" fill="{css_hex(theme.text)}" font-size="17" font-weight="800">{svg_text(chart.title)}</text>'
        f'<text x="{width - 24}" y="32" fill="{css_hex(theme.muted)}" font-size="12" text-anchor="end">{svg_text(subtitle)}</text>'
        f"{body}"
        "</svg>"
    )


def render_chart_figures(charts: list[ReportChart], theme: ReportTheme) -> str:
    if not charts:
        return ""
    figures = [
        '<figure class="chart-card">'
        f"{render_chart_svg(chart, theme)}"
        "</figure>"
        for chart in charts
    ]
    return f'<div class="chart-grid">{"".join(figures)}</div>'


def render_report_cover(model: ReportModel) -> str:
    template_label = report_template_label(model.template)
    return (
        '<section class="report-cover">'
        f'<div class="cover-date-row"><span>{html.escape(local_report_date())}</span></div>'
        '<div class="cover-copy">'
        f'<p class="doc-kicker">{html.escape(template_label)}</p>'
        f'<h1>{render_inline(model.title)}</h1>'
        '<p>基于公开信息与本次分析内容整理，适用于阅读、归档和业务沟通。</p>'
        '</div>'
        '</section>'
    )


def render_section(section: ReportSection, section_index: int, theme: ReportTheme) -> str:
    display_title = strip_section_prefix(section.title)
    section_theme = theme_with_module_accent(theme, section, section_index)
    style_attr = html.escape(inline_theme_style(section_theme), quote=True)
    rendered = [
        f'<section id="section-{section_index}" class="doc-section kind-{html.escape(section.kind)}" style="{style_attr}">',
        f'<h2>{render_inline(display_title)}</h2>',
    ]
    intro_rendered = False
    for block_index, block in enumerate(section.blocks):
        if not intro_rendered:
            if should_render_metrics(section):
                rendered.append(render_metric_cards(section.metrics))
            if section.is_empty:
                rendered.append('<p class="empty-state">本节暂无更多可展示数据。</p>')
            if section.charts:
                rendered.append(render_chart_figures(section.charts, section_theme))
            intro_rendered = True
        if block_index == 0 and block.get("type") == BlockType.Heading:
            continue
        if should_skip_report_body_block(block):
            continue
        if section.is_empty and is_empty_content_block(block):
            continue
        rendered.append(render_block(block))
    rendered.append("</section>")
    return "\n".join(rendered)


def render_blocks(model: ReportModel, theme: ReportTheme) -> str:
    if not model.sections:
        return '<section class="doc-section kind-default_section"><p>暂无可展示内容。</p></section>'
    return "\n".join(render_section(section, index, theme) for index, section in enumerate(model.sections, start=1))


def render_plain_blocks(blocks: list[Block], title: str, title_override: str | None) -> str:
    has_h1 = any(
        block.get("type") == BlockType.Heading and int(block.get("level", 2)) == 1
        for block in blocks
    )
    rendered: list[str] = []
    if title_override and not has_h1:
        rendered.append(f"<h1>{render_inline(title)}</h1>")
    rendered.extend(render_block(block) for block in blocks)
    return "\n".join(part for part in rendered if part)


def build_plain_html(blocks: list[Block], title: str, title_override: str | None, theme: ReportTheme) -> str:
    body = render_plain_blocks(blocks, title, title_override)
    style_attr = html.escape(inline_theme_style(plain_document_theme(theme)), quote=True)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
{DOCUMENT_CSS}
  </style>
</head>
<body class="theme-{html.escape(theme.id)}">
  <main class="page plain-page" style="{style_attr}">
    <article class="doc-content plain-document">
{body}
    </article>
    <footer class="doc-footer">{html.escape(AI_DISCLAIMER_TEXT)}</footer>
  </main>
</body>
</html>
"""


def build_html(markdown_text: str, title_override: str | None, theme: str) -> str:
    blocks = parse_blocks(markdown_text)
    model = build_report_model_from_blocks(blocks, title_override)
    resolved_theme = resolve_report_theme(model, theme)
    if infer_document_layout(blocks, model.title) == ReportLayout.Plain:
        return build_plain_html(blocks, model.title, title_override, resolved_theme)
    toc = render_toc(model)
    body = render_blocks(model, resolved_theme)
    theme_class = f"theme-{resolved_theme.id}"
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(model.title)}</title>
  <style>
{DOCUMENT_CSS}
  </style>
</head>
<body class="{theme_class}">
  <main class="page">
    {render_report_cover(model)}
    {toc}
    <article class="doc-content">
{body}
    </article>
    <footer class="doc-footer">{html.escape(AI_DISCLAIMER_TEXT)}</footer>
  </main>
</body>
</html>
"""


def xml_escape(value: str) -> str:
    return html.escape(value, quote=True)


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def collect_outline_rows(blocks: list[Block]) -> list[list[str]]:
    rows: list[list[str]] = [["类型", "层级", "内容"]]
    for block in blocks:
        block_type = block.get("type")
        if block_type == "heading":
            rows.append(["标题", str(block.get("level", "")), plain_inline_text(str(block.get("text") or ""))])
        elif block_type == "paragraph":
            rows.append(["段落", "", plain_inline_text(str(block.get("text") or ""))])
        elif block_type == "quote":
            rows.append(["引用", "", plain_inline_text(str(block.get("text") or ""))])
        elif block_type == "list":
            list_kind = "有序列表" if block.get("ordered") else "无序列表"
            for item in block.get("items", []):
                rows.append([list_kind, "", plain_inline_text(str(item))])
        elif block_type == "code":
            rows.append(["代码", str(block.get("language") or ""), str(block.get("text") or "")])
    return rows


def collect_report_rows(blocks: list[Block], title: str) -> list[list[str]]:
    rows: list[list[str]] = [["序号", "章节", "内容"]]
    current_section = title
    skipped_first_h1 = False
    for block in blocks:
        if should_skip_report_body_block(block) or (len(rows) == 1 and is_front_matter_block(block)):
            continue
        block_type = block.get("type")
        if block_type == "heading":
            level = int(block.get("level", 1))
            text = plain_inline_text(str(block.get("text") or ""))
            if level == 1 and not skipped_first_h1:
                skipped_first_h1 = True
                current_section = text or title
                continue
            current_section = text or current_section
            continue
        if block_type == "paragraph":
            content = plain_inline_text(str(block.get("text") or ""))
            if content:
                rows.append([str(len(rows)), current_section, content])
            continue
        if block_type == "quote":
            content = plain_inline_text(str(block.get("text") or ""))
            if content:
                rows.append([str(len(rows)), current_section, content])
            continue
        if block_type == "list":
            for item in block.get("items", []):
                content = plain_inline_text(str(item))
                if content:
                    rows.append([str(len(rows)), current_section, content])
            continue
        if block_type == "code":
            content = str(block.get("text") or "").strip()
            if content:
                rows.append([str(len(rows)), current_section, content])
    if len(rows) == 1:
        rows.append(["1", title, ""])
    return rows


def collect_tables(blocks: list[Block]) -> list[tuple[str, list[str], list[list[str]]]]:
    tables: list[tuple[str, list[str], list[list[str]]]] = []
    current_heading = ""
    for block in blocks:
        if block.get("type") == "heading":
            current_heading = plain_inline_text(str(block.get("text") or ""))
            continue
        if block.get("type") != "table":
            continue
        headers = [plain_inline_text(str(cell)) for cell in block.get("headers", [])]
        rows = [
            [plain_inline_text(str(cell)) for cell in row]
            for row in block.get("rows", [])
        ]
        table_title = current_heading or f"表格 {len(tables) + 1}"
        tables.append((table_title, headers, rows))
    return tables


DOCX_CONTENT_WIDTH_EMU = int(DOCX_CONTENT_WIDTH_DXA / 1440 * 914400)


@dataclass
class DocxMediaAsset:
    rel_id: str
    target: str
    data: bytes
    doc_pr_id: int


@dataclass
class DocxMediaRegistry:
    assets: list[DocxMediaAsset] = field(default_factory=list)

    def add_svg(self, svg: str) -> DocxMediaAsset:
        index = len(self.assets) + 1
        asset = DocxMediaAsset(
            rel_id=f"rId{index + 2}",
            target=f"media/chart{index}.svg",
            data=svg.encode("utf-8"),
            doc_pr_id=index,
        )
        self.assets.append(asset)
        return asset


def docx_paragraph_properties(style: str | None, theme: ReportTheme) -> str:
    if style == "Title":
        return (
            '<w:pPr><w:pStyle w:val="Title"/>'
            '<w:spacing w:before="0" w:after="220"/>'
            '<w:keepNext/>'
            '</w:pPr>'
        )
    if style == "CoverKicker":
        return (
            '<w:pPr><w:pStyle w:val="CoverKicker"/>'
            '<w:spacing w:before="960" w:after="140"/>'
            '<w:keepNext/>'
            '</w:pPr>'
        )
    if style == "CoverSubtitle":
        return (
            '<w:pPr><w:pStyle w:val="CoverSubtitle"/>'
            '<w:spacing w:before="120" w:after="520"/>'
            '</w:pPr>'
        )
    if style == "SectionHeading":
        if theme.style_profile == ReportStyleProfile.Framed:
            return (
                '<w:pPr><w:pStyle w:val="SectionHeading"/>'
                '<w:spacing w:before="260" w:after="150"/>'
                '<w:keepNext/><w:outlineLvl w:val="1"/>'
                f'<w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="{clean_hex(theme.line)}"/>'
                f'<w:left w:val="single" w:sz="16" w:space="8" w:color="{clean_hex(theme.accent)}"/>'
                f'<w:bottom w:val="single" w:sz="4" w:space="6" w:color="{clean_hex(theme.line)}"/>'
                f'<w:right w:val="single" w:sz="4" w:space="6" w:color="{clean_hex(theme.line)}"/></w:pBdr>'
                f'<w:shd w:fill="{clean_hex(theme.quote_bg)}"/>'
                '</w:pPr>'
            )
        if theme.style_profile == ReportStyleProfile.Ledger:
            return (
                '<w:pPr><w:pStyle w:val="SectionHeading"/>'
                '<w:spacing w:before="220" w:after="110"/>'
                '<w:keepNext/><w:outlineLvl w:val="1"/>'
                f'<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="{clean_hex(theme.line)}"/>'
                f'<w:left w:val="single" w:sz="10" w:space="6" w:color="{clean_hex(theme.accent)}"/></w:pBdr>'
                '</w:pPr>'
            )
        if theme.style_profile == ReportStyleProfile.Rail:
            return (
                '<w:pPr><w:pStyle w:val="SectionHeading"/>'
                '<w:spacing w:before="300" w:after="140"/>'
                '<w:keepNext/><w:outlineLvl w:val="1"/>'
                f'<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="{clean_hex(theme.accent)}"/></w:pBdr>'
                '</w:pPr>'
            )
        if theme.style_profile == ReportStyleProfile.Editorial:
            return (
                '<w:pPr><w:pStyle w:val="SectionHeading"/>'
                '<w:spacing w:before="360" w:after="170"/>'
                '<w:keepNext/><w:outlineLvl w:val="1"/>'
                f'<w:pBdr><w:bottom w:val="single" w:sz="10" w:space="8" w:color="{clean_hex(theme.line)}"/></w:pBdr>'
                '</w:pPr>'
            )
        return (
            '<w:pPr><w:pStyle w:val="SectionHeading"/>'
            '<w:spacing w:before="300" w:after="160"/>'
            '<w:keepNext/><w:outlineLvl w:val="1"/>'
            f'<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="8" w:color="{clean_hex(theme.line)}"/>'
            f'<w:left w:val="single" w:sz="18" w:space="8" w:color="{clean_hex(theme.accent)}"/></w:pBdr>'
            '</w:pPr>'
        )
    if style == "Heading1":
        return (
            '<w:pPr><w:pStyle w:val="Heading1"/>'
            '<w:spacing w:before="300" w:after="160"/>'
            '<w:keepNext/><w:outlineLvl w:val="0"/>'
            '</w:pPr>'
        )
    if style == "Heading2":
        return (
            '<w:pPr><w:pStyle w:val="Heading2"/>'
            '<w:spacing w:before="280" w:after="140"/>'
            '<w:keepNext/><w:outlineLvl w:val="1"/>'
            '</w:pPr>'
        )
    if style == "Heading3":
        return (
            '<w:pPr><w:pStyle w:val="Heading3"/>'
            '<w:spacing w:before="220" w:after="100"/>'
            '<w:keepNext/><w:outlineLvl w:val="2"/>'
            '</w:pPr>'
        )
    if style == "Quote":
        return (
            '<w:pPr><w:pStyle w:val="Quote"/>'
            '<w:ind w:left="360"/>'
            '<w:spacing w:before="120" w:after="140"/>'
            f'<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="{clean_hex(theme.accent)}"/></w:pBdr>'
            f'<w:shd w:fill="{clean_hex(theme.quote_bg)}"/>'
            '</w:pPr>'
        )
    if style == "ListParagraph":
        return (
            '<w:pPr><w:pStyle w:val="ListParagraph"/>'
            '<w:ind w:left="420" w:hanging="220"/>'
            '<w:spacing w:after="80"/>'
            '</w:pPr>'
        )
    if style == "Code":
        return (
            '<w:pPr><w:pStyle w:val="Code"/>'
            '<w:spacing w:before="80" w:after="140"/>'
            f'<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="{clean_hex(theme.line)}"/>'
            f'<w:left w:val="single" w:sz="4" w:space="4" w:color="{clean_hex(theme.line)}"/>'
            f'<w:bottom w:val="single" w:sz="4" w:space="4" w:color="{clean_hex(theme.line)}"/>'
            f'<w:right w:val="single" w:sz="4" w:space="4" w:color="{clean_hex(theme.line)}"/></w:pBdr>'
            f'<w:shd w:fill="{clean_hex(theme.code_bg)}"/>'
            '</w:pPr>'
        )
    if style == "SmallMuted":
        return '<w:pPr><w:spacing w:before="80" w:after="80"/></w:pPr>'
    return '<w:pPr><w:spacing w:after="120"/><w:jc w:val="both"/></w:pPr>'


def docx_run_properties(style: str | None, theme: ReportTheme) -> str:
    font = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/>'
    if style == "Title":
        size = "54" if theme.style_profile == ReportStyleProfile.Editorial else "46" if theme.style_profile == ReportStyleProfile.Ledger else "50"
        return f'<w:rPr><w:b/>{font}<w:color w:val="{clean_hex(theme.accent_strong)}"/><w:sz w:val="{size}"/></w:rPr>'
    if style == "CoverKicker":
        return f'<w:rPr><w:b/>{font}<w:color w:val="{clean_hex(theme.accent)}"/><w:sz w:val="24"/><w:caps/></w:rPr>'
    if style == "CoverSubtitle":
        return f'<w:rPr>{font}<w:color w:val="{clean_hex(theme.muted)}"/><w:sz w:val="24"/></w:rPr>'
    if style == "SectionHeading":
        size = "28" if theme.style_profile == ReportStyleProfile.Ledger else "32" if theme.style_profile == ReportStyleProfile.Editorial else "30"
        return f'<w:rPr><w:b/>{font}<w:color w:val="{clean_hex(theme.accent_strong)}"/><w:sz w:val="{size}"/></w:rPr>'
    if style == "Heading1":
        return f'<w:rPr><w:b/>{font}<w:color w:val="{clean_hex(theme.accent_strong)}"/><w:sz w:val="36"/></w:rPr>'
    if style == "Heading2":
        return f'<w:rPr><w:b/>{font}<w:color w:val="{clean_hex(theme.accent_strong)}"/><w:sz w:val="28"/></w:rPr>'
    if style == "Heading3":
        return f'<w:rPr><w:b/>{font}<w:color w:val="{clean_hex(theme.text)}"/><w:sz w:val="24"/></w:rPr>'
    if style == "Quote":
        return f'<w:rPr>{font}<w:color w:val="{clean_hex(theme.muted)}"/><w:sz w:val="22"/></w:rPr>'
    if style == "Code":
        return '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="20"/></w:rPr>'
    if style == "SmallMuted":
        return f'<w:rPr>{font}<w:color w:val="{clean_hex(theme.muted)}"/><w:sz w:val="19"/></w:rPr>'
    return f'<w:rPr>{font}<w:color w:val="{clean_hex(theme.text)}"/><w:sz w:val="22"/></w:rPr>'


def docx_paragraph(text: str, style: str | None = None, theme: ReportTheme | None = None) -> str:
    theme = theme or REPORT_THEMES[ReportThemeId.Business]
    text = plain_inline_text(text)
    return (
        "<w:p>"
        f"{docx_paragraph_properties(style, theme)}"
        f"<w:r>{docx_run_properties(style, theme)}<w:t xml:space=\"preserve\">{xml_escape(text)}</w:t></w:r>"
        "</w:p>"
    )


def docx_page_break() -> str:
    return '<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>'


def docx_chart_drawing(chart: ReportChart, media: DocxMediaRegistry, theme: ReportTheme) -> str:
    width, height = chart_svg_size(chart)
    asset = media.add_svg(render_chart_svg(chart, theme))
    image_cx = DOCX_CONTENT_WIDTH_EMU
    image_cy = int(image_cx * height / width)
    title = xml_escape(chart.title)
    return (
        "<w:p>"
        '<w:pPr><w:spacing w:before="160" w:after="160"/><w:keepNext/></w:pPr>'
        "<w:r>"
        "<w:drawing>"
        '<wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{image_cx}" cy="{image_cy}"/>'
        '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
        f'<wp:docPr id="{asset.doc_pr_id}" name="{title}"/>'
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
        "<a:graphic>"
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        "<pic:pic>"
        "<pic:nvPicPr>"
        f'<pic:cNvPr id="{asset.doc_pr_id + 1000}" name="{title}"/>'
        '<pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr>'
        "</pic:nvPicPr>"
        "<pic:blipFill>"
        f'<a:blip r:embed="{asset.rel_id}"/>'
        '<a:stretch><a:fillRect/></a:stretch>'
        "</pic:blipFill>"
        "<pic:spPr>"
        f'<a:xfrm><a:off x="0" y="0"/><a:ext cx="{image_cx}" cy="{image_cy}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        "</pic:spPr>"
        "</pic:pic>"
        "</a:graphicData>"
        "</a:graphic>"
        "</wp:inline>"
        "</w:drawing>"
        "</w:r>"
        "</w:p>"
    )


def docx_chart_drawings(charts: list[ReportChart], media: DocxMediaRegistry, theme: ReportTheme) -> str:
    return "".join(docx_chart_drawing(chart, media, theme) for chart in charts)


def docx_render_block(block: Block, theme: ReportTheme) -> str:
    block_type = block.get("type")
    if block_type == BlockType.Heading:
        text = str(block.get("text") or "")
        level = int(block.get("level", 1))
        style = f"Heading{min(max(level, 1), 3)}"
        return docx_paragraph(text, style, theme)
    if block_type == BlockType.Paragraph:
        return docx_paragraph(str(block.get("text") or ""), theme=theme)
    if block_type == BlockType.Quote:
        return docx_paragraph(str(block.get("text") or ""), "Quote", theme)
    if block_type == BlockType.List:
        items = []
        for item_index, item in enumerate(block.get("items", []), start=1):
            prefix = f"{item_index}. " if block.get("ordered") else "• "
            items.append(docx_paragraph(f"{prefix}{item}", "ListParagraph", theme))
        return "".join(items)
    if block_type == BlockType.Table:
        headers = [str(cell) for cell in block.get("headers", [])]
        rows = [[str(cell) for cell in row] for row in block.get("rows", [])]
        return docx_table(headers, rows, theme)
    if block_type == BlockType.Code:
        return docx_paragraph(str(block.get("text") or ""), "Code", theme)
    if block_type == BlockType.Rule:
        return docx_paragraph("", theme=theme)
    return ""


def docx_column_widths(headers: list[str], rows: list[list[str]]) -> list[int]:
    all_rows = [headers, *rows] if headers else rows
    column_count = max((len(row) for row in all_rows), default=1)
    if column_count == 1:
        return [DOCX_CONTENT_WIDTH_DXA]
    normalized_headers = [compact_plain_text(str(cell)) for cell in headers]
    if column_count == 2 and (
        not headers
        or normalized_headers[0] in ("字段", "项目", "类型", "指标", "名称")
        or normalized_headers[1] in ("内容", "值", "数值", "说明")
    ):
        return [2600, DOCX_CONTENT_WIDTH_DXA - 2600]
    weights: list[float] = []
    for index in range(column_count):
        values = [str(row[index]) for row in all_rows if index < len(row)]
        max_width = max((excel_text_width(value) for value in values), default=8)
        header = normalized_headers[index] if index < len(normalized_headers) else ""
        if header in ("序号", "编号", "排名"):
            weights.append(0.55)
        elif any(key in header for key in ("日期", "数量", "占比", "比例", "状态", "结果")):
            weights.append(0.85)
        else:
            weights.append(max(1.0, min(max_width / 10, 2.4)))
    min_width = 760
    available = DOCX_CONTENT_WIDTH_DXA - min_width * column_count
    if available <= 0:
        return [max(700, DOCX_CONTENT_WIDTH_DXA // column_count)] * column_count
    weight_total = sum(weights) or 1
    widths = [min_width + int(available * weight / weight_total) for weight in weights]
    widths[-1] += DOCX_CONTENT_WIDTH_DXA - sum(widths)
    return widths


def docx_table_cell(
    text: str,
    width: int,
    theme: ReportTheme,
    *,
    header: bool = False,
    label: bool = False,
    shade: bool = False,
) -> str:
    fill = ""
    color = clean_hex(theme.text)
    bold = ""
    if header:
        fill = f'<w:shd w:fill="{clean_hex(theme.table_header_fill)}"/>'
        color = clean_hex(theme.table_header_text)
        bold = "<w:b/>"
    elif label:
        fill = f'<w:shd w:fill="{clean_hex(theme.accent_soft)}"/>'
        color = clean_hex(theme.accent_strong)
        bold = "<w:b/>"
    elif shade:
        fill = f'<w:shd w:fill="{clean_hex(theme.subtle)}"/>'
    return (
        "<w:tc>"
        "<w:tcPr>"
        f"<w:tcW w:w=\"{width}\" w:type=\"dxa\"/>"
        f"{fill}"
        "<w:vAlign w:val=\"top\"/>"
        "<w:tcMar>"
        "<w:top w:w=\"120\" w:type=\"dxa\"/>"
        "<w:left w:w=\"150\" w:type=\"dxa\"/>"
        "<w:bottom w:w=\"120\" w:type=\"dxa\"/>"
        "<w:right w:w=\"150\" w:type=\"dxa\"/>"
        "</w:tcMar>"
        "</w:tcPr>"
        "<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\"/><w:jc w:val=\"left\"/></w:pPr><w:r>"
        f"<w:rPr>{bold}<w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\" w:eastAsia=\"Microsoft YaHei\"/>"
        f"<w:color w:val=\"{color}\"/><w:sz w:val=\"20\"/></w:rPr>"
        f"<w:t xml:space=\"preserve\">{xml_escape(plain_inline_text(text))}</w:t>"
        "</w:r></w:p>"
        "</w:tc>"
    )


def docx_table(headers: list[str], rows: list[list[str]], theme: ReportTheme) -> str:
    theme = light_table_theme(theme)
    all_rows = [headers, *rows] if headers else rows
    column_count = max((len(row) for row in all_rows), default=1)
    column_widths = docx_column_widths(headers, rows)
    table_rows: list[str] = []
    for row_index, row in enumerate(all_rows):
        padded = row + [""] * (column_count - len(row))
        is_header = row_index == 0 and bool(headers)
        row_pr = "<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>" if is_header else "<w:trPr><w:cantSplit/></w:trPr>"
        shade = row_index % 2 == 0
        cells = [
            docx_table_cell(
                str(cell),
                column_widths[index],
                theme,
                header=is_header,
                label=(not is_header and column_count == 2 and index == 0),
                shade=(shade and not is_header),
            )
            for index, cell in enumerate(padded)
        ]
        table_rows.append(f"<w:tr>{row_pr}{''.join(cells)}</w:tr>")
    grid_cols = "".join(f'<w:gridCol w:w="{width}"/>' for width in column_widths)
    return (
        "<w:tbl>"
        "<w:tblPr>"
        f"<w:tblW w:w=\"{DOCX_CONTENT_WIDTH_DXA}\" w:type=\"dxa\"/>"
        "<w:tblLayout w:type=\"fixed\"/>"
        '<w:tblCellSpacing w:w="0" w:type="dxa"/>'
        "<w:tblCellMar>"
        "<w:top w:w=\"120\" w:type=\"dxa\"/>"
        "<w:left w:w=\"140\" w:type=\"dxa\"/>"
        "<w:bottom w:w=\"120\" w:type=\"dxa\"/>"
        "<w:right w:w=\"140\" w:type=\"dxa\"/>"
        "</w:tblCellMar>"
        "<w:tblBorders>"
        f"<w:top w:val=\"single\" w:sz=\"5\" w:space=\"0\" w:color=\"{clean_hex(theme.line)}\"/>"
        f"<w:left w:val=\"single\" w:sz=\"5\" w:space=\"0\" w:color=\"{clean_hex(theme.line)}\"/>"
        f"<w:bottom w:val=\"single\" w:sz=\"5\" w:space=\"0\" w:color=\"{clean_hex(theme.line)}\"/>"
        f"<w:right w:val=\"single\" w:sz=\"5\" w:space=\"0\" w:color=\"{clean_hex(theme.line)}\"/>"
        f"<w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"{clean_hex(theme.line)}\"/>"
        f"<w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"{clean_hex(theme.line)}\"/>"
        "</w:tblBorders>"
        "<w:tblLook w:val=\"04A0\" w:firstRow=\"1\" w:lastRow=\"0\" w:firstColumn=\"0\" w:lastColumn=\"0\" w:noHBand=\"0\" w:noVBand=\"1\"/>"
        "</w:tblPr>"
        "<w:tblGrid>"
        f"{grid_cols}"
        "</w:tblGrid>"
        f"{''.join(table_rows)}"
        "</w:tbl>"
    )


def docx_cover_band(model: ReportModel, theme: ReportTheme) -> str:
    label = report_template_label(model.template)
    date = local_report_date()
    widths = [DOCX_CONTENT_WIDTH_DXA // 2, DOCX_CONTENT_WIDTH_DXA - DOCX_CONTENT_WIDTH_DXA // 2]
    cells = [
        docx_table_cell(label, widths[0], theme, header=True),
        docx_table_cell(date, widths[1], theme, header=True),
    ]
    grid_cols = "".join(f'<w:gridCol w:w="{width}"/>' for width in widths)
    return (
        "<w:tbl>"
        "<w:tblPr>"
        f"<w:tblW w:w=\"{DOCX_CONTENT_WIDTH_DXA}\" w:type=\"dxa\"/>"
        "<w:tblLayout w:type=\"fixed\"/>"
        "<w:tblBorders><w:top w:val=\"nil\"/><w:left w:val=\"nil\"/><w:bottom w:val=\"nil\"/><w:right w:val=\"nil\"/><w:insideH w:val=\"nil\"/><w:insideV w:val=\"nil\"/></w:tblBorders>"
        "</w:tblPr>"
        f"<w:tblGrid>{grid_cols}</w:tblGrid>"
        f"<w:tr><w:trPr><w:cantSplit/></w:trPr>{''.join(cells)}</w:tr>"
        "</w:tbl>"
    )


def docx_cover_xml(model: ReportModel, theme: ReportTheme) -> str:
    return "".join([
        docx_cover_band(model, theme),
        docx_paragraph(report_template_label(model.template), "CoverKicker", theme),
        docx_paragraph(model.title, "Title", theme),
        docx_paragraph("基于公开信息与本次分析内容整理，适用于阅读、归档和业务沟通。", "CoverSubtitle", theme),
        docx_page_break(),
    ])


def docx_section_heading(section: ReportSection, section_index: int, theme: ReportTheme) -> str:
    del section_index
    return docx_paragraph(strip_section_prefix(section.title), "SectionHeading", theme)


def build_docx_footer_xml(theme: ReportTheme) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:p>"
        "<w:pPr>"
        '<w:jc w:val="center"/>'
        '<w:spacing w:before="120" w:after="0"/>'
        f'<w:pBdr><w:top w:val="single" w:sz="6" w:space="12" w:color="{clean_hex(theme.line)}"/></w:pBdr>'
        "</w:pPr>"
        "<w:r>"
        '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/>'
        f'<w:color w:val="{clean_hex(theme.muted)}"/><w:sz w:val="18"/></w:rPr>'
        f'<w:t xml:space="preserve">{xml_escape(AI_DISCLAIMER_TEXT)}</w:t>'
        "</w:r>"
        "</w:p>"
        "</w:ftr>"
    )


def build_docx_header_xml(title: str, theme: ReportTheme) -> str:
    header_title = truncate_text(title, 38)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:p>"
        "<w:pPr>"
        '<w:tabs><w:tab w:val="right" w:pos="9026"/></w:tabs>'
        f'<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="8" w:color="{clean_hex(theme.line)}"/></w:pBdr>'
        '<w:spacing w:after="80"/>'
        "</w:pPr>"
        "<w:r>"
        f'<w:rPr><w:b/><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:color w:val="{clean_hex(theme.accent_strong)}"/><w:sz w:val="18"/></w:rPr>'
        '<w:t xml:space="preserve">报告文档</w:t>'
        "</w:r>"
        "<w:r><w:tab/></w:r>"
        "<w:r>"
        f'<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:color w:val="{clean_hex(theme.muted)}"/><w:sz w:val="18"/></w:rPr>'
        f'<w:t xml:space="preserve">{xml_escape(header_title)}</w:t>'
        "</w:r>"
        "</w:p>"
        "</w:hdr>"
    )


def build_docx_document_xml(model: ReportModel, media: DocxMediaRegistry, theme: ReportTheme) -> str:
    body: list[str] = [
        docx_cover_xml(model, theme),
    ]
    if len(model.sections) >= 2:
        body.append(docx_paragraph("目录", "Heading1", theme))
        toc_rows = [["序号", "章节"]]
        for index, section in enumerate(model.sections, start=1):
            toc_rows.append([str(index), strip_section_prefix(section.title)])
        body.append(docx_table(toc_rows[0], toc_rows[1:], theme))
        body.append(docx_page_break())

    for section_index, section in enumerate(model.sections, start=1):
        section_theme = theme_with_module_accent(theme, section, section_index)
        body.append(docx_section_heading(section, section_index, section_theme))
        if should_render_metrics(section):
            metric_rows = [[metric.label, metric.value] for metric in section.metrics]
            body.append(docx_table(["指标", "数值"], metric_rows, section_theme))
        if section.is_empty:
            body.append(docx_paragraph("本节暂无更多可展示数据。", "Quote", section_theme))
        if section.charts:
            body.append(docx_chart_drawings(section.charts, media, section_theme))
        for block_index, block in enumerate(section.blocks):
            if block_index == 0 and block.get("type") == BlockType.Heading:
                continue
            if should_skip_report_body_block(block):
                continue
            if section.is_empty and is_empty_content_block(block):
                continue
            body.append(docx_render_block(block, section_theme))

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        "<w:body>"
        f"{''.join(body)}"
        "<w:sectPr>"
        '<w:footerReference w:type="default" r:id="rId1"/>'
        '<w:headerReference w:type="default" r:id="rId2"/>'
        f"<w:pgSz w:w=\"{DOCX_PAGE_WIDTH_DXA}\" w:h=\"{DOCX_PAGE_HEIGHT_DXA}\"/>"
        f"<w:pgMar w:top=\"{DOCX_PAGE_MARGIN_DXA}\" w:right=\"{DOCX_PAGE_MARGIN_DXA}\" w:bottom=\"{DOCX_PAGE_MARGIN_DXA}\" w:left=\"{DOCX_PAGE_MARGIN_DXA}\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/>"
        "</w:sectPr>"
        "</w:body>"
        "</w:document>"
    )


def build_docx_plain_document_xml(
    blocks: list[Block],
    title: str,
    title_override: str | None,
    theme: ReportTheme,
) -> str:
    has_h1 = any(
        block.get("type") == BlockType.Heading and int(block.get("level", 2)) == 1
        for block in blocks
    )
    body: list[str] = []
    if title_override and not has_h1:
        body.append(docx_paragraph(title, "Title", theme))
    body.extend(docx_render_block(block, theme) for block in blocks)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        "<w:body>"
        f"{''.join(body)}"
        "<w:sectPr>"
        '<w:footerReference w:type="default" r:id="rId1"/>'
        f"<w:pgSz w:w=\"{DOCX_PAGE_WIDTH_DXA}\" w:h=\"{DOCX_PAGE_HEIGHT_DXA}\"/>"
        f"<w:pgMar w:top=\"{DOCX_PAGE_MARGIN_DXA}\" w:right=\"{DOCX_PAGE_MARGIN_DXA}\" w:bottom=\"{DOCX_PAGE_MARGIN_DXA}\" w:left=\"{DOCX_PAGE_MARGIN_DXA}\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/>"
        "</w:sectPr>"
        "</w:body>"
        "</w:document>"
    )


DOCX_STYLES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="120"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="0" w:after="220"/><w:keepNext/></w:pPr>
    <w:rPr><w:b/><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:color w:val="0B3D78"/><w:sz w:val="50"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CoverKicker">
    <w:name w:val="Cover Kicker"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="960" w:after="140"/><w:keepNext/></w:pPr>
    <w:rPr><w:b/><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:color w:val="15559A"/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CoverSubtitle">
    <w:name w:val="Cover Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="120" w:after="520"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:color w:val="667085"/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="SectionHeading">
    <w:name w:val="Section Heading"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="300" w:after="160"/><w:keepNext/><w:outlineLvl w:val="1"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="8" w:color="D6DEEB"/><w:left w:val="single" w:sz="18" w:space="8" w:color="15559A"/></w:pBdr></w:pPr>
    <w:rPr><w:b/><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:color w:val="0B3D78"/><w:sz w:val="30"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="SmallMuted">
    <w:name w:val="Small Muted"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="80" w:after="80"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:color w:val="667085"/><w:sz w:val="19"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="320" w:after="160"/><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:color w:val="0B3D78"/><w:sz w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="280" w:after="140"/><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:color w:val="0B3D78"/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="220" w:after="100"/><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:color w:val="15223A"/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="360"/><w:spacing w:before="120" w:after="120"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="15559A"/></w:pBdr><w:shd w:fill="F4F8FC"/></w:pPr>
    <w:rPr><w:color w:val="667085"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="420" w:hanging="220"/><w:spacing w:after="80"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="80" w:after="120"/><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="D8E0EA"/><w:left w:val="single" w:sz="4" w:space="4" w:color="D8E0EA"/><w:bottom w:val="single" w:sz="4" w:space="4" w:color="D8E0EA"/><w:right w:val="single" w:sz="4" w:space="4" w:color="D8E0EA"/></w:pBdr><w:shd w:fill="F6F8FB"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="20"/></w:rPr>
  </w:style>
</w:styles>
"""


def build_docx_styles_xml(theme: ReportTheme) -> str:
    replacements = {
        "0B3D78": theme.accent_strong,
        "15559A": theme.accent,
        "667085": theme.muted,
        "D6DEEB": theme.line,
        "D8E0EA": theme.line,
        "F4F8FC": theme.quote_bg,
        "F6F8FB": theme.code_bg,
        "15223A": theme.text,
    }
    xml = DOCX_STYLES_XML
    for source, target in replacements.items():
        xml = xml.replace(source, clean_hex(target))
    return xml


def write_zip_text(zf: zipfile.ZipFile, name: str, value: str) -> None:
    zf.writestr(name, value.encode("utf-8"))


def write_docx(markdown_text: str, docx_path: Path, title_override: str | None) -> None:
    blocks = parse_blocks(markdown_text)
    title = extract_title(blocks, title_override)
    model = build_report_model_from_blocks(blocks, title)
    theme = office_theme(resolve_report_theme(model))
    created = now_iso()
    media = DocxMediaRegistry()
    if infer_document_layout(blocks, title) == ReportLayout.Plain:
        theme = plain_document_theme(theme)
        document_xml = build_docx_plain_document_xml(blocks, title, title_override, theme)
    else:
        document_xml = build_docx_document_xml(model, media, theme)
    media_content_type = '  <Default Extension="svg" ContentType="image/svg+xml"/>\n' if media.assets else ""
    media_relationships = "\n".join(
        f'  <Relationship Id="{asset.rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{xml_escape(asset.target)}"/>'
        for asset in media.assets
    )
    docx_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        write_zip_text(
            zf,
            "[Content_Types].xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
{media_content_type}  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
""",
        )
        write_zip_text(
            zf,
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
""",
        )
        write_zip_text(
            zf,
            "word/_rels/document.xml.rels",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
{media_relationships}
</Relationships>
""",
        )
        write_zip_text(zf, "word/document.xml", document_xml)
        for asset in media.assets:
            zf.writestr(f"word/{asset.target}", asset.data)
        write_zip_text(zf, "word/footer1.xml", build_docx_footer_xml(theme))
        write_zip_text(zf, "word/header1.xml", build_docx_header_xml(title, theme))
        write_zip_text(zf, "word/styles.xml", build_docx_styles_xml(theme))
        write_zip_text(
            zf,
            "docProps/core.xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{xml_escape(title)}</dc:title>
  <dc:creator>BizOwl</dc:creator>
  <cp:lastModifiedBy>BizOwl</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{created}</dcterms:modified>
</cp:coreProperties>
""",
        )
        write_zip_text(
            zf,
            "docProps/app.xml",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>BizOwl</Application>
</Properties>
""",
        )


def excel_column_name(index: int) -> str:
    name = ""
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def sanitize_sheet_name(value: str, fallback: str, used: set[str]) -> str:
    name = re.sub(r"[\[\]:*?/\\]", " ", value).strip() or fallback
    name = re.sub(r"\s+", " ", name)[:31].strip() or fallback
    original = name
    suffix = 2
    while name in used:
        tail = f" {suffix}"
        name = f"{original[:31 - len(tail)]}{tail}".strip()
        suffix += 1
    used.add(name)
    return name


def is_cjk_character(char: str) -> bool:
    code = ord(char)
    return (
        0x3040 <= code <= 0x30FF
        or 0x3400 <= code <= 0x9FFF
        or 0xF900 <= code <= 0xFAFF
        or 0xAC00 <= code <= 0xD7AF
    )


def excel_text_width(value: str) -> int:
    text = plain_inline_text(str(value))
    lines = text.splitlines() or [text]
    max_width = 0
    for line in lines:
        width = sum(2 if is_cjk_character(char) else 1 for char in line)
        max_width = max(max_width, width)
    return max_width


def xlsx_column_widths(rows: list[list[str]], column_count: int) -> list[float]:
    widths: list[float] = []
    for column_index in range(column_count):
        max_width = 0
        for row in rows:
            if column_index < len(row):
                max_width = max(max_width, excel_text_width(str(row[column_index])))
        widths.append(float(min(max(max_width + 2, 10), 48)))
    return widths or [12.0]


def xlsx_row_height(row: list[str], row_index: int) -> float:
    if row_index == 1:
        return 24.0
    max_width = max((excel_text_width(str(value)) for value in row), default=0)
    if max_width > 44:
        return 42.0
    if max_width > 24:
        return 32.0
    return 22.0


def xlsx_cell(row_index: int, column_index: int, value: str, style: int = 0) -> str:
    ref = f"{excel_column_name(column_index)}{row_index}"
    style_attr = f' s="{style}"' if style else ""
    return (
        f'<c r="{ref}" t="inlineStr"{style_attr}>'
        f'<is><t xml:space="preserve">{xml_escape(value)}</t></is>'
        "</c>"
    )


def with_disclaimer_rows(rows: list[list[str]]) -> list[list[str]]:
    if rows and any(has_ai_disclaimer(cell) for cell in rows[-1]):
        return rows
    return [*rows, [], [AI_DISCLAIMER_TEXT]]


def is_disclaimer_row(row: list[str]) -> bool:
    return any(has_ai_disclaimer(cell) for cell in row)


def xlsx_data_row_count(rows: list[list[str]]) -> int:
    count = len(rows)
    if count and is_disclaimer_row(rows[-1]):
        count -= 1
        if count and not any(str(value).strip() for value in rows[count - 1]):
            count -= 1
    return max(count, 0)


def build_xlsx_sheet_xml(rows: list[list[str]]) -> str:
    column_count = max((len(row) for row in rows), default=1)
    last_cell = f"{excel_column_name(column_count)}{max(len(rows), 1)}"
    sheet_range = f"A1:{last_cell}"
    data_row_count = xlsx_data_row_count(rows)
    last_data_cell = f"{excel_column_name(column_count)}{max(data_row_count, 1)}"
    data_range = f"A1:{last_data_cell}"
    widths = xlsx_column_widths(rows, column_count)
    cols = "".join(
        f'<col min="{index}" max="{index}" width="{width:.1f}" customWidth="1" bestFit="1"/>'
        for index, width in enumerate(widths, start=1)
    )
    sheet_rows: list[str] = []
    for row_index, row in enumerate(rows, start=1):
        padded = row + [""] * (column_count - len(row))
        height = xlsx_row_height(padded, row_index)
        disclaimer_row = is_disclaimer_row(padded)
        cells = []
        for column_index, value in enumerate(padded, start=1):
            if disclaimer_row and column_index == 1:
                style = 3
            elif row_index == 1 and row_index <= data_row_count:
                style = 1
            elif row_index <= data_row_count:
                style = 2
            else:
                style = 0
            cells.append(xlsx_cell(row_index, column_index, plain_inline_text(str(value)), style))
        sheet_rows.append(f'<row r="{row_index}" ht="{height:.1f}" customHeight="1">{"".join(cells)}</row>')
    auto_filter = f'<autoFilter ref="{data_range}"/>' if data_row_count > 1 and column_count > 1 else ""
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<dimension ref="{sheet_range}"/>'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>'
        '<sheetFormatPr defaultRowHeight="22"/>'
        f"<cols>{cols}</cols>"
        f"<sheetData>{''.join(sheet_rows)}</sheetData>"
        f"{auto_filter}"
        '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
        "</worksheet>"
    )


def chart_xlsx_rows(section: ReportSection, chart: ReportChart) -> list[list[str]]:
    rows = [
        ["图表名称", chart.title],
        ["图表类型", chart_kind_label(chart.kind)],
        ["所属章节", strip_section_prefix(section.title)],
        ["单位", chart.unit or "-"],
        [],
        ["分类", "数值"],
    ]
    for category, value in zip(chart.categories, chart.values):
        rows.append([category, chart_value_text(value, chart.unit)])
    return rows


def build_xlsx_sheets(blocks: list[Block], title: str, model: ReportModel | None = None) -> list[tuple[str, list[list[str]]]]:
    model = model or build_report_model_from_blocks(blocks, title)
    tables = collect_tables(blocks)
    used_names: set[str] = set()
    if not tables and not model.charts:
        name = sanitize_sheet_name(title, "Report", used_names)
        return [(name, with_disclaimer_rows(collect_report_rows(blocks, title)))]
    sheets: list[tuple[str, list[list[str]]]] = []
    table_sheets: list[tuple[str, list[list[str]], str, int, int]] = []
    chart_sheets: list[tuple[str, list[list[str]], str, ReportChart]] = []

    for section_index, section in enumerate(model.sections, start=1):
        section_tables = collect_tables(section.blocks)
        for table_index, (table_title, headers, rows) in enumerate(section_tables, start=1):
            fallback = f"Table {len(table_sheets) + 1}"
            sheet_title = section.title if len(section_tables) == 1 else f"{section.title}-{table_index}"
            name = sanitize_sheet_name(sheet_title or table_title, fallback, used_names)
            table_rows = [headers, *rows] if headers else rows
            table_sheets.append((name, with_disclaimer_rows(table_rows), section.title or table_title, len(rows), len(headers)))
        for chart_index, chart in enumerate(section.charts, start=1):
            fallback = f"Chart {len(chart_sheets) + 1}"
            sheet_title = f"图表-{chart.title}" if len(section.charts) == 1 else f"图表-{chart.title}-{chart_index}"
            name = sanitize_sheet_name(sheet_title, fallback, used_names)
            chart_sheets.append((name, with_disclaimer_rows(chart_xlsx_rows(section, chart)), section.title, chart))

    summary_rows = [["序号", "工作表", "类别", "内容范围", "记录数", "字段数"]]
    for index, (sheet_name, _table_rows, table_title, row_count, field_count) in enumerate(table_sheets, start=1):
        section_kind = next((section.kind for section in model.sections if section.title == table_title), ModuleKind.DefaultTable)
        summary_rows.append([str(index), sheet_name, module_kind_label(section_kind), table_title, str(row_count), str(field_count)])
    for chart_index, (sheet_name, _chart_rows, section_title, chart) in enumerate(chart_sheets, start=len(table_sheets) + 1):
        summary_rows.append([
            str(chart_index),
            sheet_name,
            "图表数据",
            f"{strip_section_prefix(section_title)} - {chart.title}",
            str(len(chart.values)),
            "2",
        ])
    sheets.append((sanitize_sheet_name("报告摘要", "Summary", used_names), with_disclaimer_rows(summary_rows)))
    sheets.extend((sheet_name, table_rows) for sheet_name, table_rows, _title, _row_count, _field_count in table_sheets)
    sheets.extend((sheet_name, chart_rows) for sheet_name, chart_rows, _section_title, _chart in chart_sheets)
    return sheets


def build_xlsx_styles_xml(theme: ReportTheme) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/><color rgb="{argb_hex(theme.table_header_text)}"/></font><font><sz val="10"/><name val="Microsoft YaHei"/><color rgb="{argb_hex(theme.muted)}"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="{argb_hex(theme.table_header_fill)}"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="{argb_hex(theme.line)}"/></left><right style="thin"><color rgb="{argb_hex(theme.line)}"/></right><top style="thin"><color rgb="{argb_hex(theme.line)}"/></top><bottom style="thin"><color rgb="{argb_hex(theme.line)}"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>
"""


def write_xlsx(markdown_text: str, xlsx_path: Path, title_override: str | None) -> None:
    blocks = parse_blocks(markdown_text)
    title = extract_title(blocks, title_override)
    model = build_report_model_from_blocks(blocks, title)
    theme = office_theme(resolve_report_theme(model))
    sheets = build_xlsx_sheets(blocks, title, model)
    created = now_iso()
    xlsx_path.parent.mkdir(parents=True, exist_ok=True)
    sheet_overrides = "\n".join(
        f'  <Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for index in range(1, len(sheets) + 1)
    )
    workbook_sheets = "\n".join(
        f'    <sheet name="{xml_escape(name)}" sheetId="{index}" r:id="rId{index}"/>'
        for index, (name, _) in enumerate(sheets, start=1)
    )
    workbook_rels = "\n".join(
        f'  <Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>'
        for index in range(1, len(sheets) + 1)
    )
    styles_rel_id = len(sheets) + 1
    with zipfile.ZipFile(xlsx_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        write_zip_text(
            zf,
            "[Content_Types].xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
{sheet_overrides}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
""",
        )
        write_zip_text(
            zf,
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
""",
        )
        write_zip_text(
            zf,
            "xl/workbook.xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
{workbook_sheets}
  </sheets>
</workbook>
""",
        )
        write_zip_text(
            zf,
            "xl/_rels/workbook.xml.rels",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{workbook_rels}
  <Relationship Id="rId{styles_rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
""",
        )
        write_zip_text(
            zf,
            "xl/styles.xml",
            build_xlsx_styles_xml(theme),
        )
        for index, (_name, rows) in enumerate(sheets, start=1):
            write_zip_text(zf, f"xl/worksheets/sheet{index}.xml", build_xlsx_sheet_xml(rows))
        write_zip_text(
            zf,
            "docProps/core.xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{xml_escape(title)}</dc:title>
  <dc:creator>BizOwl</dc:creator>
  <cp:lastModifiedBy>BizOwl</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{created}</dcterms:modified>
</cp:coreProperties>
""",
        )
        write_zip_text(
            zf,
            "docProps/app.xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>BizOwl</Application>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>{len(sheets)}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="{len(sheets)}" baseType="lpstr">{''.join(f'<vt:lpstr>{xml_escape(name)}</vt:lpstr>' for name, _ in sheets)}</vt:vector></TitlesOfParts>
</Properties>
""",
        )


def write_csv_output(markdown_text: str, csv_path: Path, title_override: str | None) -> None:
    blocks = parse_blocks(markdown_text)
    tables = collect_tables(blocks)
    title = extract_title(blocks, title_override)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        if tables:
            for index, (table_title, headers, rows) in enumerate(tables):
                if len(tables) > 1:
                    if index > 0:
                        writer.writerow([])
                    writer.writerow([table_title])
                if headers:
                    writer.writerow(headers)
                writer.writerows(rows)
            writer.writerow([])
            writer.writerow([AI_DISCLAIMER_TEXT])
            return
        writer.writerow([title])
        writer.writerows(collect_outline_rows(blocks))
        writer.writerow([])
        writer.writerow([AI_DISCLAIMER_TEXT])


PPTX_SLIDE_CX = 12192000
PPTX_SLIDE_CY = 6858000
PPTX_MARGIN_X = 620000
PPTX_TITLE_Y = 360000
PPTX_DEFAULT_TEXT = REPORT_THEMES[ReportThemeId.Business].text
PPTX_BODY_FILL = REPORT_THEMES[ReportThemeId.Business].paper_bg
PPTX_FOOTER_RULE_Y = PPTX_SLIDE_CY - 560000
PPTX_FOOTER_Y = PPTX_SLIDE_CY - 380000


@dataclass
class PptxSlideMedia:
    rel_id: str
    target: str
    data: bytes


@dataclass
class PptxSlide:
    xml: str
    media: list[PptxSlideMedia] = field(default_factory=list)


def truncate_text(value: str, max_chars: int) -> str:
    text = re.sub(r"\s+", " ", plain_inline_text(value)).strip()
    if len(text) <= max_chars:
        return text
    return text[: max(1, max_chars - 1)].rstrip() + "…"


def pptx_wrap_text(value: str, width: int, max_lines: int | None = None) -> list[str]:
    text = re.sub(r"\s+", " ", plain_inline_text(value)).strip()
    if not text:
        return [""]
    lines = textwrap.wrap(
        text,
        width=max(8, width),
        break_long_words=True,
        break_on_hyphens=False,
        replace_whitespace=False,
    ) or [text]
    if max_lines is not None and len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = truncate_text(lines[-1], max(8, width))
    return lines


def pptx_run_xml(text: str, font_size: int, bold: bool = False, color: str = PPTX_DEFAULT_TEXT) -> str:
    bold_attr = ' b="1"' if bold else ""
    return (
        "<a:r>"
        f'<a:rPr lang="zh-CN" sz="{font_size}"{bold_attr}>'
        f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
        '<a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/>'
        "</a:rPr>"
        f"<a:t>{xml_escape(text)}</a:t>"
        "</a:r>"
    )


def pptx_paragraph_xml(
    text: str,
    font_size: int,
    bold: bool = False,
    color: str = PPTX_DEFAULT_TEXT,
    align: str | None = None,
) -> str:
    paragraph_properties = f'<a:pPr algn="{align}"/>' if align else ""
    return f"<a:p>{paragraph_properties}{pptx_run_xml(text, font_size, bold, color)}</a:p>"


def pptx_text_shape(
    shape_id: int,
    name: str,
    x: int,
    y: int,
    cx: int,
    cy: int,
    lines: list[str],
    font_size: int = 1800,
    bold: bool = False,
    color: str = PPTX_DEFAULT_TEXT,
    fill: str | None = None,
    line: str | None = None,
    margin: int = 120000,
    align: str | None = None,
) -> str:
    paragraphs = "".join(pptx_paragraph_xml(line, font_size, bold, color, align) for line in lines)
    fill_xml = f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else "<a:noFill/>"
    line_xml = f'<a:ln><a:solidFill><a:srgbClr val="{line}"/></a:solidFill></a:ln>' if line else "<a:ln><a:noFill/></a:ln>"
    return (
        "<p:sp>"
        "<p:nvSpPr>"
        f'<p:cNvPr id="{shape_id}" name="{xml_escape(name)}"/>'
        '<p:cNvSpPr txBox="1"/>'
        "<p:nvPr/>"
        "</p:nvSpPr>"
        "<p:spPr>"
        f'<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        f"{fill_xml}{line_xml}"
        "</p:spPr>"
        "<p:txBody>"
        f'<a:bodyPr wrap="square" anchor="t" lIns="{margin}" tIns="{margin}" rIns="{margin}" bIns="{margin}"/>'
        "<a:lstStyle/>"
        f"{paragraphs}"
        "</p:txBody>"
        "</p:sp>"
    )


def pptx_picture_shape(
    shape_id: int,
    name: str,
    rel_id: str,
    x: int,
    y: int,
    cx: int,
    cy: int,
) -> str:
    return (
        "<p:pic>"
        "<p:nvPicPr>"
        f'<p:cNvPr id="{shape_id}" name="{xml_escape(name)}"/>'
        '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>'
        "<p:nvPr/>"
        "</p:nvPicPr>"
        "<p:blipFill>"
        f'<a:blip r:embed="{rel_id}"/>'
        '<a:stretch><a:fillRect/></a:stretch>'
        "</p:blipFill>"
        "<p:spPr>"
        f'<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        "</p:spPr>"
        "</p:pic>"
    )


def pptx_group_shape_xml() -> str:
    return (
        "<p:nvGrpSpPr>"
        '<p:cNvPr id="1" name=""/>'
        "<p:cNvGrpSpPr/>"
        "<p:nvPr/>"
        "</p:nvGrpSpPr>"
        "<p:grpSpPr>"
        '<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>'
        "</p:grpSpPr>"
    )


def pptx_footer_shapes(theme: ReportTheme) -> list[str]:
    return [
        pptx_text_shape(
            9000,
            "AI disclaimer rule",
            PPTX_MARGIN_X,
            PPTX_FOOTER_RULE_Y,
            PPTX_SLIDE_CX - PPTX_MARGIN_X * 2,
            22000,
            [""],
            fill=clean_hex(theme.line),
            margin=0,
        ),
        pptx_text_shape(
            9001,
            "AI disclaimer",
            PPTX_MARGIN_X,
            PPTX_FOOTER_Y,
            PPTX_SLIDE_CX - PPTX_MARGIN_X * 2,
            240000,
            [AI_DISCLAIMER_TEXT],
            font_size=950,
            color=clean_hex(theme.muted),
            margin=0,
            align="ctr",
        ),
    ]


def pptx_slide_xml(shapes: list[str], theme: ReportTheme) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
        'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        "<p:cSld>"
        f'<p:bg><p:bgPr><a:solidFill><a:srgbClr val="{clean_hex(theme.paper_bg)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
        f"<p:spTree>{pptx_group_shape_xml()}{''.join(shapes)}</p:spTree>"
        "</p:cSld>"
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>"
        "</p:sld>"
    )


def pptx_slide_with_footer(slide_xml: str, theme: ReportTheme) -> str:
    if "AI disclaimer" in slide_xml:
        return slide_xml
    return slide_xml.replace("</p:spTree>", f"{''.join(pptx_footer_shapes(theme))}</p:spTree>", 1)


def pptx_accent_shape(shape_id: int, theme: ReportTheme, y: int) -> str:
    # Some PPT viewers render this decorative rule detached from the title.
    # Drop it entirely instead of leaving an unexplained horizontal line.
    return ""


def build_pptx_title_slide(title: str, subtitle: str, theme: ReportTheme) -> str:
    shapes = [
        pptx_text_shape(
            2,
            "Title",
            PPTX_MARGIN_X,
            1550000,
            PPTX_SLIDE_CX - PPTX_MARGIN_X * 2,
            1150000,
            pptx_wrap_text(title, 30, 2),
            font_size=3400,
            bold=True,
            color=clean_hex(theme.accent_strong),
            margin=0,
        ),
        pptx_text_shape(
            3,
            "Subtitle",
            PPTX_MARGIN_X,
            2860000,
            PPTX_SLIDE_CX - PPTX_MARGIN_X * 2,
            980000,
            pptx_wrap_text(subtitle, 54, 3),
            font_size=1700,
            color=clean_hex(theme.muted),
            margin=0,
        ),
        pptx_accent_shape(4, theme, 4180000),
    ]
    return pptx_slide_xml(shapes, theme)


def build_pptx_text_slide(title: str, lines: list[str], theme: ReportTheme) -> str:
    wrapped: list[str] = []
    for line in lines:
        wrapped.extend(pptx_wrap_text(line, 48, 2))
    if not wrapped:
        wrapped = ["暂无更多内容"]
    shapes = [
        pptx_text_shape(
            2,
            "Slide title",
            PPTX_MARGIN_X,
            PPTX_TITLE_Y,
            PPTX_SLIDE_CX - PPTX_MARGIN_X * 2,
            760000,
            pptx_wrap_text(title, 34, 2),
            font_size=2600,
            bold=True,
            color=clean_hex(theme.accent_strong),
            margin=0,
        ),
        pptx_accent_shape(3, theme, 1180000),
        pptx_text_shape(
            4,
            "Content",
            PPTX_MARGIN_X,
            1500000,
            PPTX_SLIDE_CX - PPTX_MARGIN_X * 2,
            4550000,
            wrapped[:12],
            font_size=1750,
            color=clean_hex(theme.text),
            margin=0,
        ),
    ]
    return pptx_slide_xml(shapes, theme)


def build_pptx_table_slide(title: str, headers: list[str], rows: list[list[str]], theme: ReportTheme) -> str:
    table_rows = ([headers] if headers else []) + rows
    if not table_rows:
        return build_pptx_text_slide(title, ["暂无表格数据"], theme)
    column_count = min(max((len(row) for row in table_rows), default=1), 4)
    visible_rows = table_rows[:8]
    table_x = PPTX_MARGIN_X
    table_y = 1500000
    table_w = PPTX_SLIDE_CX - PPTX_MARGIN_X * 2
    row_h = 520000
    col_w = table_w // column_count
    shapes = [
        pptx_text_shape(
            2,
            "Slide title",
            PPTX_MARGIN_X,
            PPTX_TITLE_Y,
            PPTX_SLIDE_CX - PPTX_MARGIN_X * 2,
            760000,
            pptx_wrap_text(title, 34, 2),
            font_size=2500,
            bold=True,
            color=clean_hex(theme.accent_strong),
            margin=0,
        ),
        pptx_accent_shape(3, theme, 1180000),
    ]
    shape_id = 4
    for row_index, row in enumerate(visible_rows):
        padded = [plain_inline_text(str(cell)) for cell in row[:column_count]]
        padded += [""] * (column_count - len(padded))
        for col_index, cell in enumerate(padded):
            shapes.append(
                pptx_text_shape(
                    shape_id,
                    f"Table {row_index + 1}-{col_index + 1}",
                    table_x + col_index * col_w,
                    table_y + row_index * row_h,
                    col_w,
                    row_h,
                    pptx_wrap_text(cell, 16, 2),
                    font_size=1180 if row_index else 1250,
                    bold=row_index == 0 and bool(headers),
                    color=clean_hex(theme.table_header_text) if row_index == 0 and headers else clean_hex(theme.text),
                    fill=clean_hex(theme.table_header_fill) if row_index == 0 and headers else PPTX_BODY_FILL,
                    line=clean_hex(theme.line),
                    margin=76000,
                )
            )
            shape_id += 1
    if len(table_rows) > len(visible_rows) or max((len(row) for row in table_rows), default=0) > column_count:
        shapes.append(
            pptx_text_shape(
                shape_id,
                "Table note",
                PPTX_MARGIN_X,
                table_y + len(visible_rows) * row_h + 180000,
                PPTX_SLIDE_CX - PPTX_MARGIN_X * 2,
                360000,
                ["表格较长，PPTX 仅展示前几行/前几列，完整数据请查看报告正文或 XLSX。"],
                font_size=1200,
                color=clean_hex(theme.muted),
                margin=0,
            )
        )
    return pptx_slide_xml(shapes, theme)


def build_pptx_chart_slide(section_title: str, chart: ReportChart, media_name: str, theme: ReportTheme) -> PptxSlide:
    svg_width, svg_height = chart_svg_size(chart)
    rel_id = "rId2"
    image_x = PPTX_MARGIN_X
    image_y = 1400000
    image_w = PPTX_SLIDE_CX - PPTX_MARGIN_X * 2
    image_h = int(image_w * svg_height / svg_width)
    max_image_h = PPTX_SLIDE_CY - image_y - 760000
    if image_h > max_image_h:
        image_h = max_image_h
        image_w = int(image_h * svg_width / svg_height)
        image_x = (PPTX_SLIDE_CX - image_w) // 2
    shapes = [
        pptx_text_shape(
            2,
            "Slide title",
            PPTX_MARGIN_X,
            PPTX_TITLE_Y,
            PPTX_SLIDE_CX - PPTX_MARGIN_X * 2,
            620000,
            pptx_wrap_text(chart.title, 34, 2),
            font_size=2500,
            bold=True,
            color=clean_hex(theme.accent_strong),
            margin=0,
        ),
        pptx_text_shape(
            3,
            "Section title",
            PPTX_MARGIN_X,
            960000,
            PPTX_SLIDE_CX - PPTX_MARGIN_X * 2,
            300000,
            pptx_wrap_text(strip_section_prefix(section_title), 52, 1),
            font_size=1250,
            color=clean_hex(theme.muted),
            margin=0,
        ),
        pptx_accent_shape(4, theme, 1240000),
        pptx_picture_shape(5, chart.title, rel_id, image_x, image_y, image_w, image_h),
    ]
    return PptxSlide(
        xml=pptx_slide_xml(shapes, theme),
        media=[PptxSlideMedia(rel_id=rel_id, target=f"../media/{media_name}", data=render_chart_svg(chart, theme).encode("utf-8"))],
    )


def append_pptx_text_slides(slides: list[PptxSlide], title: str, lines: list[str], theme: ReportTheme) -> None:
    cleaned = [truncate_text(line, 140) for line in lines if plain_inline_text(line)]
    if not cleaned:
        return
    chunk_size = 6
    for index in range(0, len(cleaned), chunk_size):
        chunk = cleaned[index:index + chunk_size]
        suffix = "" if index == 0 else f"（{index // chunk_size + 1}）"
        slides.append(PptxSlide(build_pptx_text_slide(f"{title}{suffix}", chunk, theme)))


def build_pptx_slides(
    markdown_text: str,
    title_override: str | None,
) -> tuple[str, list[PptxSlide], ReportTheme]:
    model = build_report_model(markdown_text, title_override)
    theme = office_theme(resolve_report_theme(model))
    first_paragraph = next(
        (plain_inline_text(str(block.get("text") or "")) for block in model.blocks if block.get("type") == BlockType.Paragraph),
        "由 BizOwl 根据当前会话内容生成。",
    )
    slides: list[PptxSlide] = [PptxSlide(build_pptx_title_slide(model.title, truncate_text(first_paragraph, 120), theme))]
    summary_lines = [f"{index}. {section.title}" for index, section in enumerate(model.sections[:8], start=1)]
    if model.metrics:
        summary_lines = [f"{metric.label}: {metric.value}" for metric in model.metrics[:6]] + summary_lines[:4]
    if summary_lines:
        slides.append(PptxSlide(build_pptx_text_slide("报告摘要", summary_lines, theme)))

    chart_media_index = 1
    for section_index, section in enumerate(model.sections, start=1):
        section_theme = theme_with_module_accent(theme, section, section_index)
        for chart in section.charts:
            media_name = f"chart{chart_media_index}.svg"
            slides.append(build_pptx_chart_slide(section.title, chart, media_name, section_theme))
            chart_media_index += 1
        section_lines: list[str] = []
        table_rendered = False
        for block in section.blocks:
            block_type = block.get("type")
            if block_type == BlockType.Heading:
                continue
            if block_type == BlockType.Paragraph or block_type == BlockType.Quote:
                section_lines.append(str(block.get("text") or ""))
                continue
            if block_type == BlockType.List:
                for item in block.get("items", []):
                    section_lines.append(f"• {item}")
                continue
            if block_type == BlockType.Table and not table_rendered:
                headers = [plain_inline_text(str(cell)) for cell in block.get("headers", [])]
                rows = [[plain_inline_text(str(cell)) for cell in row] for row in block.get("rows", [])]
                slides.append(PptxSlide(build_pptx_table_slide(section.title, headers, rows, section_theme)))
                table_rendered = True
                continue
            if block_type == BlockType.Code:
                section_lines.append(str(block.get("text") or ""))
        append_pptx_text_slides(slides, section.title, section_lines, section_theme)
    if len(slides) == 1:
        append_pptx_text_slides(slides, "报告摘要", [first_paragraph], theme)
    if slides:
        slides[-1].xml = pptx_slide_with_footer(slides[-1].xml, theme)
    return model.title, slides, theme


def pptx_presentation_xml(slide_count: int) -> str:
    slide_ids = "\n".join(
        f'    <p:sldId id="{255 + index}" r:id="rId{index + 1}"/>'
        for index in range(1, slide_count + 1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
{slide_ids}
  </p:sldIdLst>
  <p:sldSz cx="{PPTX_SLIDE_CX}" cy="{PPTX_SLIDE_CY}" type="wide"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle>
    <a:defPPr><a:defRPr lang="zh-CN"><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/></a:defRPr></a:defPPr>
  </p:defaultTextStyle>
</p:presentation>
"""


PPTX_THEME_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="QccDocumentTheme">
  <a:themeElements>
    <a:clrScheme name="QccDocument">
      <a:dk1><a:srgbClr val="172033"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="24324A"/></a:dk2>
      <a:lt2><a:srgbClr val="EEF2F7"/></a:lt2>
      <a:accent1><a:srgbClr val="1F6FEB"/></a:accent1>
      <a:accent2><a:srgbClr val="147A46"/></a:accent2>
      <a:accent3><a:srgbClr val="B42318"/></a:accent3>
      <a:accent4><a:srgbClr val="637083"/></a:accent4>
      <a:accent5><a:srgbClr val="D8E0EA"/></a:accent5>
      <a:accent6><a:srgbClr val="F6F8FB"/></a:accent6>
      <a:hlink><a:srgbClr val="1F6FEB"/></a:hlink>
      <a:folHlink><a:srgbClr val="637083"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="QccFonts">
      <a:majorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:majorFont>
      <a:minorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="QccFormat">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>
"""


def build_pptx_theme_xml(theme: ReportTheme) -> str:
    replacements = {
        "172033": theme.text,
        "24324A": theme.accent_strong,
        "EEF2F7": theme.subtle,
        "1F6FEB": theme.accent,
        "147A46": theme.success,
        "B42318": theme.risk,
        "637083": theme.muted,
        "D8E0EA": theme.line,
        "F6F8FB": theme.code_bg,
    }
    xml = PPTX_THEME_XML
    for source, target in replacements.items():
        xml = xml.replace(source, clean_hex(target))
    return xml


PPTX_SLIDE_MASTER_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
  </p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>
"""


PPTX_SLIDE_LAYOUT_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>
"""


def write_pptx(markdown_text: str, pptx_path: Path, title_override: str | None) -> None:
    title, slides, theme = build_pptx_slides(markdown_text, title_override)
    created = now_iso()
    has_svg_media = any(slide.media for slide in slides)
    svg_content_type = '  <Default Extension="svg" ContentType="image/svg+xml"/>\n' if has_svg_media else ""
    pptx_path.parent.mkdir(parents=True, exist_ok=True)
    slide_overrides = "\n".join(
        f'  <Override PartName="/ppt/slides/slide{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        for index in range(1, len(slides) + 1)
    )
    presentation_rels = "\n".join(
        [
            '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
            *[
                f'  <Relationship Id="rId{index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{index}.xml"/>'
                for index in range(1, len(slides) + 1)
            ],
            f'  <Relationship Id="rId{len(slides) + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>',
        ]
    )
    with zipfile.ZipFile(pptx_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        write_zip_text(
            zf,
            "[Content_Types].xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
{svg_content_type}  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
{slide_overrides}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
""",
        )
        write_zip_text(
            zf,
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
""",
        )
        write_zip_text(zf, "ppt/presentation.xml", pptx_presentation_xml(len(slides)))
        write_zip_text(
            zf,
            "ppt/_rels/presentation.xml.rels",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{presentation_rels}
</Relationships>
""",
        )
        write_zip_text(zf, "ppt/slideMasters/slideMaster1.xml", PPTX_SLIDE_MASTER_XML)
        write_zip_text(
            zf,
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>
""",
        )
        write_zip_text(zf, "ppt/slideLayouts/slideLayout1.xml", PPTX_SLIDE_LAYOUT_XML)
        write_zip_text(
            zf,
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>
""",
        )
        write_zip_text(zf, "ppt/theme/theme1.xml", build_pptx_theme_xml(theme))
        for index, slide in enumerate(slides, start=1):
            write_zip_text(zf, f"ppt/slides/slide{index}.xml", slide.xml)
            media_relationships = "\n".join(
                f'  <Relationship Id="{media.rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{xml_escape(media.target)}"/>'
                for media in slide.media
            )
            write_zip_text(
                zf,
                f"ppt/slides/_rels/slide{index}.xml.rels",
                f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
{media_relationships}
</Relationships>
""",
            )
            for media in slide.media:
                zf.writestr(f"ppt/media/{Path(media.target).name}", media.data)
        write_zip_text(
            zf,
            "docProps/core.xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{xml_escape(title)}</dc:title>
  <dc:creator>BizOwl</dc:creator>
  <cp:lastModifiedBy>BizOwl</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{created}</dcterms:modified>
</cp:coreProperties>
""",
        )
        write_zip_text(
            zf,
            "docProps/app.xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>BizOwl</Application>
  <PresentationFormat>On-screen Show (16:9)</PresentationFormat>
  <Slides>{len(slides)}</Slides>
</Properties>
""",
        )


DOCUMENT_CSS = (
    build_theme_css(":root", REPORT_THEMES[ReportThemeId.Business])
    + r"""

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  color: var(--text);
  background: #ffffff;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.65;
  letter-spacing: 0;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.page {
  width: min(1040px, calc(100vw - 40px));
  min-height: calc(100vh - 64px);
  margin: 32px auto;
  padding: 44px 56px 56px;
  display: flex;
  flex-direction: column;
  background: var(--paper-bg);
  border: 1px solid var(--line);
  border-radius: var(--page-radius);
  box-shadow: var(--shadow);
}

.doc-content {
  flex: 1;
}

.plain-page {
  width: min(860px, calc(100vw - 40px));
  padding: 56px 64px;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.plain-document {
  color: var(--text);
}

.plain-document h1 {
  margin: 0 0 28px;
  color: var(--text);
  text-align: center;
  font-size: 28px;
  font-weight: 800;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.plain-document h2 {
  margin-top: 28px;
  padding-bottom: 8px;
  color: var(--text);
  border-bottom: 1px solid var(--line);
  font-size: 20px;
  font-weight: 750;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.plain-document h3 {
  color: var(--text);
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.plain-document th {
  color: var(--text);
  background: var(--subtle);
}

.plain-document tbody tr:nth-child(even) td {
  background: #ffffff;
}

.report-cover {
  position: relative;
  min-height: var(--cover-min-height);
  margin: -44px -56px 36px;
  padding: 42px 56px 48px;
  overflow: hidden;
  background: var(--paper-bg);
  border-bottom: 1px solid var(--line);
}

.cover-date-row {
  display: flex;
  justify-content: flex-end;
  padding-bottom: 24px;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  font-weight: 650;
}

.cover-copy {
  position: relative;
  z-index: 1;
  max-width: 760px;
  margin-top: var(--cover-copy-margin-top);
}

.cover-copy h1 {
  margin-top: 8px;
  color: var(--accent-strong);
  font-size: var(--cover-title-size);
  font-weight: 850;
}

.cover-copy p:last-child {
  max-width: 620px;
  color: var(--muted);
  font-size: 14px;
}

.doc-header {
  padding-bottom: 28px;
  border-bottom: 2px solid var(--text);
  margin-bottom: 28px;
}

.doc-kicker {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1,
h2,
h3,
h4,
h5,
h6 {
  color: var(--text);
  line-height: 1.3;
  letter-spacing: 0;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

h1 {
  margin: 0 0 18px;
  font-size: 26px;
  font-weight: 700;
}

.toc {
  margin: 0 0 28px;
  padding: var(--toc-padding);
  border: 1px solid var(--line);
  border-left: var(--toc-border-left-width) solid var(--accent);
  border-radius: var(--toc-radius);
  background: var(--accent-soft);
}

h3 {
  margin: 20px 0 8px;
  font-size: 17px;
  font-weight: 700;
}

.toc ol {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 6px 18px;
  margin: 0;
  padding-left: 1.4em;
}

.toc li {
  margin: 0;
  padding: 4px 0;
  color: var(--accent-strong);
}

.toc a {
  color: var(--accent);
  border-bottom: 0;
}

.doc-section {
  position: relative;
  margin-top: var(--section-margin-top);
  padding: var(--section-padding);
  border: var(--section-border);
  border-left: var(--section-border-left-width) solid var(--accent);
  border-bottom: var(--section-border-bottom-width) solid var(--line);
  border-radius: var(--section-radius);
  background: var(--section-bg);
  break-inside: avoid;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.metric-card {
  padding: var(--metric-padding);
  border: 1px solid var(--line);
  border-radius: var(--metric-radius);
  background: var(--paper-bg);
}

.metric-card span {
  display: block;
  color: var(--muted);
  font-size: 12px;
}

.metric-card strong {
  display: block;
  margin-top: 4px;
  color: var(--accent);
  font-size: 20px;
  line-height: 1.2;
}

.metric-card strong.tone-risk {
  color: var(--risk);
}

.chart-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  margin-top: 16px;
}

.chart-card {
  margin: 0;
  padding: 0;
  break-inside: avoid;
}

.report-chart-svg {
  display: block;
  width: 100%;
  height: auto;
}

.empty-state {
  padding: 12px 14px;
  color: var(--muted);
  background: var(--subtle);
  border-radius: 8px;
}

.doc-section h1 {
  font-size: 28px;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.doc-section h2 {
  display: block;
  margin: 0 0 16px;
  padding: 0 0 10px;
  color: var(--accent-strong);
  border-bottom: 1px solid var(--line);
  font-size: 22px;
  font-weight: 800;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.doc-section h3 {
  margin-top: 22px;
  font-size: 18px;
  font-weight: 750;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.doc-section h4 {
  margin-top: 18px;
  font-size: 16px;
  font-weight: 750;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

p {
  margin: 8px 0;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

strong {
  font-weight: 700;
}

a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

ul,
ol {
  margin: 8px 0;
  padding-left: 1.5em;
}

li {
  word-wrap: break-word;
  overflow-wrap: break-word;
}

li + li {
  margin-top: 4px;
}

blockquote {
  margin: 10px 0;
  padding: 0 0 0 12px;
  color: var(--muted);
  border-left: 4px solid var(--accent);
  background: var(--quote-bg);
  border-radius: 8px;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.table-wrap {
  width: 100%;
  margin: 12px 0;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--table-radius);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 1.5;
}

th,
td {
  min-width: 96px;
  padding: var(--table-cell-padding);
  text-align: left;
  vertical-align: middle;
  border-bottom: 1px solid var(--line);
}

th {
  color: var(--text);
  background: var(--subtle);
  font-weight: 800;
  white-space: nowrap;
}

tbody tr:nth-child(even) td {
  background: var(--subtle);
}

tr:last-child td {
  border-bottom: 0;
}

.doc-footer {
  margin-top: 32px;
  padding-top: 28px;
  border-top: 2px solid var(--line);
  color: var(--muted);
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
}

code {
  font-family: var(--font-mono);
  font-size: 0.92em;
  padding: 0.1em 0.28em;
  background: var(--soft);
}

pre {
  margin: 12px 0;
  padding: 12px;
  overflow-x: auto;
  border-radius: 8px;
  background: var(--code-bg);
  color: var(--text);
}

pre code {
  padding: 0;
  background: transparent;
}

hr {
  margin: 18px 0;
  border: 0;
  border-top: 1px solid var(--line);
}

@media (max-width: 720px) {
  .page {
    width: 100%;
    margin: 0;
    padding: 18px;
  }

  .plain-page {
    padding: 24px 18px;
  }

  .report-cover {
    margin: -28px -18px 24px;
    padding: 28px 18px;
  }

  .cover-copy h1 {
    font-size: 30px;
  }

  .doc-header h1 {
    font-size: 26px;
  }

  .doc-section {
    padding: 18px 16px;
  }
}

@media print {
  @page {
    size: A4;
    margin: 16mm 14mm;
  }

  body {
    background: #ffffff !important;
  }

  body {
    color: var(--text);
    font-size: 11pt;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }

  .page {
    width: auto;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .plain-page {
    border: 0;
    box-shadow: none;
  }

  .plain-document h1 {
    margin-bottom: 18pt;
    font-size: 20pt;
  }

  .plain-document h2 {
    margin-top: 16pt;
    padding-bottom: 5pt;
    font-size: 14pt;
  }

  .report-cover {
    min-height: var(--print-cover-min-height);
    margin: 0 0 12mm;
    padding: 24mm 18mm;
    background: #ffffff !important;
    break-after: page;
  }

  .cover-copy {
    margin-top: var(--print-cover-copy-margin-top);
  }

  .cover-copy h1 {
    font-size: 30pt;
  }

  .metric-grid,
  .chart-card,
  .empty-state {
    break-inside: avoid;
  }

  .doc-header {
    margin-bottom: 16pt;
    padding-bottom: 14pt;
  }

  .doc-header h1 {
    font-size: 24pt;
  }

  .toc {
    margin: 0 0 14pt;
    padding: 0 0 10pt;
    border-bottom: 1px solid var(--line);
    break-inside: avoid;
  }

  .toc h2 {
    margin: 0 0 6pt;
    font-size: 15pt;
  }

  .toc ol {
    display: block;
    margin: 0;
    padding-left: 18pt;
  }

  .toc li {
    margin: 2pt 0;
  }

  .toc a {
    color: var(--text);
    border-bottom: 0;
    text-decoration: none;
  }

  .doc-section {
    margin-top: var(--print-section-margin-top);
    padding: var(--print-section-padding);
    border: var(--print-section-border);
    border-left: var(--print-section-border-left-width) solid var(--accent);
    border-bottom: var(--print-section-border-bottom-width) solid var(--line);
    border-radius: var(--print-section-radius);
    background: var(--print-section-bg) !important;
    break-inside: auto;
  }

  .doc-section::before {
    content: none;
  }

  .doc-section h1 {
    font-size: 20pt;
  }

  h2 {
    margin-top: 16pt;
    padding: var(--print-heading-padding);
    border-bottom: var(--print-heading-border-bottom);
    font-size: 16pt;
  }

  h3 {
    margin-top: 12pt;
    font-size: 12pt;
  }

  .table-wrap {
    overflow: visible;
    border-radius: 0;
  }

  table {
    width: 100% !important;
    max-width: 100%;
    table-layout: fixed;
    font-size: 8.5pt;
  }

  th,
  td {
    min-width: 0;
    word-break: break-word;
    overflow-wrap: anywhere;
    white-space: normal;
  }

  th {
    white-space: normal;
  }

  .doc-footer {
    margin-top: 18pt;
    padding-top: 14pt;
    border-top: 1pt solid var(--line);
    color: var(--muted);
    font-size: 9pt;
    break-inside: avoid;
  }
}
"""
)


def find_browser() -> str | None:
    env_path = os.environ.get("BIZOWL_CHROMIUM_PATH")
    candidates = [env_path] if env_path else []
    candidates.extend(
        [
            shutil.which("google-chrome"),
            shutil.which("google-chrome-stable"),
            shutil.which("chromium"),
            shutil.which("chromium-browser"),
            shutil.which("msedge"),
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            str(Path.home() / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ]
    )
    if os.name == "nt":
        for root_name in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            root = os.environ.get(root_name)
            if not root:
                continue
            candidates.extend(
                [
                    str(Path(root) / "Google/Chrome/Application/chrome.exe"),
                    str(Path(root) / "Microsoft/Edge/Application/msedge.exe"),
                ]
            )
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def print_browser_pdf(html_path: Path, pdf_path: Path) -> tuple[bool, str]:
    browser = find_browser()
    if not browser:
        return False, "No Chrome/Chromium-compatible browser was found for PDF printing."
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--allow-file-access-from-files",
        f"--print-to-pdf={str(pdf_path)}",
        "--print-to-pdf-no-header",
        "--no-pdf-header-footer",
        html_path.resolve().as_uri(),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=60, check=False)
    except Exception as error:  # pragma: no cover - depends on local browser availability
        return False, f"PDF printing failed: {error}"
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        return False, f"PDF printing failed with exit code {result.returncode}: {detail}"
    if not pdf_path.exists() or pdf_path.stat().st_size == 0:
        return False, "PDF printing completed but no non-empty PDF file was created."
    return True, str(pdf_path)


def remove_stale_pdf(pdf_path: Path) -> None:
    try:
        pdf_path.unlink()
    except FileNotFoundError:
        return
    except OSError:
        return


def load_cjk_helper():
    helper_path = Path(__file__).resolve().parents[2] / "pdf" / "scripts" / "cjk_reportlab.py"
    spec = importlib.util.spec_from_file_location("qcc_cjk_reportlab", helper_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load CJK helper from {helper_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def contains_cjk(text: str) -> bool:
    return bool(re.search(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]", text))


def summarize_font_info(font_info: dict) -> str:
    font_name = str(font_info.get("font_name") or "unknown")
    embedded = "embedded" if font_info.get("embedded") else "not embedded"
    font_path = font_info.get("font_path")
    subfont_index = font_info.get("subfont_index")
    parts = [font_name, embedded]
    if font_path:
        parts.append(str(font_path))
    if subfont_index is not None:
        parts.append(f"subfont {subfont_index}")
    return ", ".join(parts)


def check_reportlab_cjk() -> tuple[bool, str]:
    try:
        cjk = load_cjk_helper()
        font_info = cjk.register_cjk_font(allow_cid_fallback=False)
    except Exception as error:
        return False, f"ReportLab CJK preflight failed: {error}"
    return True, f"ReportLab CJK preflight passed: {summarize_font_info(font_info)}"


def render_pdf_inline(text: str, font_name: str) -> str:
    placeholders: dict[str, str] = {}

    def stash(value: str) -> str:
        key = f"@@QCCDOCPDFINLINE{len(placeholders)}@@"
        placeholders[key] = value
        return key

    def replace_code(match: re.Match[str]) -> str:
        value = html.escape(match.group(1))
        return stash(f'<font name="{html.escape(font_name)}">{value}</font>')

    def replace_link(match: re.Match[str]) -> str:
        label = html.escape(match.group(1))
        href = match.group(2).strip()
        if not re.match(r"^(https?://|mailto:|#)", href):
            return html.escape(match.group(0))
        return stash(f'<a href="{html.escape(href, quote=True)}">{label}</a>')

    working = re.sub(r"`([^`]+)`", replace_code, text)
    working = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", replace_link, working)
    working = html.escape(working)
    working = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", working)
    working = re.sub(r"__([^_]+)__", r"<b>\1</b>", working)
    working = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<i>\1</i>", working)
    working = re.sub(r"(?<!_)_([^_\n]+)_(?!_)", r"<i>\1</i>", working)
    for key, value in placeholders.items():
        working = working.replace(html.escape(key), value)
    return working


def print_reportlab_pdf(
    markdown_text: str,
    pdf_path: Path,
    title_override: str | None,
) -> tuple[bool, str]:
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_LEFT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.pdfgen.canvas import Canvas
        from reportlab.platypus import Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table, TableStyle
    except Exception as error:
        return False, f"ReportLab is not available: {error}"

    try:
        cjk = load_cjk_helper()
        font_info = cjk.register_cjk_font()
        font_name = font_info["font_name"]
    except Exception as error:
        return False, f"CJK font registration failed: {error}"

    blocks = parse_blocks(markdown_text)
    title = extract_title(blocks, title_override)
    model = build_report_model_from_blocks(blocks, title)
    theme = office_theme(resolve_report_theme(model))
    if infer_document_layout(blocks, title) == ReportLayout.Plain:
        theme = plain_document_theme(theme)
    table_theme = light_table_theme(theme)
    pdf_path.parent.mkdir(parents=True, exist_ok=True)

    styles = getSampleStyleSheet()
    cjk.apply_cjk_font_to_styles(styles, font_name)
    normal = ParagraphStyle(
        "QccBody",
        parent=styles["BodyText"],
        fontName=font_name,
        fontSize=10.5,
        leading=17,
        spaceAfter=6,
        alignment=TA_LEFT,
    )
    title_style = ParagraphStyle(
        "QccTitle",
        parent=styles["Title"],
        fontName=font_name,
        fontSize=22,
        leading=29,
        spaceAfter=12,
        textColor=colors.HexColor(css_hex(theme.accent_strong)),
    )
    heading_styles = {
        1: title_style,
        2: ParagraphStyle(
            "QccHeading2",
            parent=styles["Heading2"],
            fontName=font_name,
            fontSize=15,
            leading=21,
            spaceBefore=12,
            spaceAfter=8,
            textColor=colors.HexColor(css_hex(theme.accent_strong)),
        ),
        3: ParagraphStyle(
            "QccHeading3",
            parent=styles["Heading3"],
            fontName=font_name,
            fontSize=12.5,
            leading=18,
            spaceBefore=9,
            spaceAfter=5,
            textColor=colors.HexColor(css_hex(theme.text)),
        ),
    }
    quote_style = ParagraphStyle(
        "QccQuote",
        parent=normal,
        fontName=font_name,
        leftIndent=8,
        rightIndent=0,
        spaceBefore=3,
        spaceAfter=3,
        textColor=colors.HexColor(css_hex(theme.muted)),
    )
    code_style = ParagraphStyle(
        "QccCode",
        parent=normal,
        fontName=font_name,
        fontSize=8.5,
        leading=12,
        backColor=colors.HexColor(css_hex(theme.code_bg)),
        borderPadding=6,
    )
    table_header = ParagraphStyle(
        "QccTableHeader",
        parent=normal,
        fontName=font_name,
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor(css_hex(table_theme.table_header_text)),
    )
    table_cell = ParagraphStyle(
        "QccTableCell",
        parent=normal,
        fontName=font_name,
        fontSize=8.2,
        leading=11,
    )

    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=16 * mm,
        bottomMargin=24 * mm,
        title=title,
    )
    has_h1 = any(
        block.get("type") == "heading" and int(block.get("level", 2)) == 1
        for block in blocks
    )
    story: list[object] = []
    if title_override and not has_h1:
        story.extend([Paragraph(render_pdf_inline(title, font_name), title_style), Spacer(1, 6)])

    for block in blocks:
        block_type = block.get("type")
        if block_type == "heading":
            level = int(block.get("level", 2))
            text = str(block.get("text") or "")
            style = heading_styles.get(level, heading_styles[3])
            story.append(Paragraph(render_pdf_inline(text, font_name), style))
            continue

        if block_type == "paragraph":
            story.append(Paragraph(render_pdf_inline(str(block.get("text") or ""), font_name), normal))
            continue

        if block_type == "quote":
            quote = "<br/>".join(
                render_pdf_inline(part, font_name) for part in str(block.get("text") or "").split("\n")
            )
            story.append(Paragraph(quote, quote_style))
            story.append(Spacer(1, 4))
            continue

        if block_type == "list":
            for item in block.get("items", []):
                prefix = "1. " if block.get("ordered") else "- "
                story.append(Paragraph(prefix + render_pdf_inline(str(item), font_name), normal))
            continue

        if block_type == "table":
            headers = [str(cell) for cell in block.get("headers", [])]
            rows = [[str(cell) for cell in row] for row in block.get("rows", [])]
            column_count = max([len(headers), *(len(row) for row in rows)] or [1])
            header_row = headers + [""] * (column_count - len(headers))
            table_data: list[list[object]] = [
                [Paragraph(render_pdf_inline(cell, font_name), table_header) for cell in header_row]
            ]
            for row in rows:
                padded = row + [""] * (column_count - len(row))
                table_data.append([Paragraph(render_pdf_inline(cell, font_name), table_cell) for cell in padded])
            col_width = doc.width / column_count
            table = Table(table_data, colWidths=[col_width] * column_count, repeatRows=1)
            table.setStyle(
                TableStyle(
                    [
                        ("FONTNAME", (0, 0), (-1, -1), font_name),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(css_hex(table_theme.table_header_fill))),
                        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor(css_hex(table_theme.table_header_text))),
                        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor(css_hex(theme.line))),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 5),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                        ("TOPPADDING", (0, 0), (-1, -1), 5),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ]
                )
            )
            story.append(table)
            story.append(Spacer(1, 8))
            continue

        if block_type == "code":
            story.append(Preformatted(str(block.get("text") or ""), code_style))
            story.append(Spacer(1, 6))
            continue

        if block_type == "rule":
            story.append(Spacer(1, 8))

    def draw_footer(canvas, document) -> None:
        canvas.saveState()
        width, _height = document.pagesize
        y = 13 * mm
        canvas.setStrokeColor(colors.HexColor(css_hex(theme.line)))
        canvas.setLineWidth(0.6)
        canvas.line(document.leftMargin, y + 16, width - document.rightMargin, y + 16)
        canvas.setFont(font_name, 8.5)
        canvas.setFillColor(colors.HexColor(css_hex(theme.muted)))
        canvas.drawCentredString(width / 2, y, AI_DISCLAIMER_TEXT)
        canvas.restoreState()

    class LastPageFooterCanvas(Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._saved_page_states: list[dict[str, object]] = []

        def showPage(self) -> None:
            self._saved_page_states.append(dict(self.__dict__))
            self._startPage()

        def save(self) -> None:
            page_count = len(self._saved_page_states)
            for page_index, state in enumerate(self._saved_page_states, start=1):
                self.__dict__.update(state)
                if page_index == page_count:
                    draw_footer(self, doc)
                super().showPage()
            super().save()

    try:
        doc.build(story, canvasmaker=LastPageFooterCanvas)
    except Exception as error:
        return False, f"ReportLab PDF build failed: {error}"

    if not pdf_path.exists() or pdf_path.stat().st_size == 0:
        return False, "ReportLab completed but no non-empty PDF file was created."

    if contains_cjk(markdown_text):
        extracted_text = cjk.extract_pdf_text(str(pdf_path))
        if extracted_text is None:
            print(
                "PDF note: CJK text extraction was unavailable; keeping the ReportLab PDF after CJK font registration.",
                file=sys.stderr,
            )
        elif cjk.contains_replacement_glyphs(extracted_text):
            return False, f"CJK verification found replacement glyphs in the generated PDF. Font: {summarize_font_info(font_info)}."
        elif title and title not in extracted_text:
            print(
                f"PDF note: CJK text extraction did not include the report title. Font: {summarize_font_info(font_info)}.",
                file=sys.stderr,
            )

    return True, str(pdf_path)


def print_pdf_auto(
    markdown_text: str,
    html_path: Path,
    pdf_path: Path,
    title_override: str | None,
) -> tuple[bool, str]:
    browser_ok, browser_message = print_browser_pdf(html_path, pdf_path)
    if browser_ok:
        return True, browser_message

    print(
        f"PDF note: Browser engine failed; trying ReportLab fallback. {browser_message}",
        file=sys.stderr,
    )
    remove_stale_pdf(pdf_path)
    reportlab_ok, reportlab_message = print_reportlab_pdf(markdown_text, pdf_path, title_override)
    if reportlab_ok:
        print("PDF note: ReportLab engine regenerated the PDF after browser failed.", file=sys.stderr)
        return True, reportlab_message
    return False, f"{browser_message} ReportLab fallback also failed: {reportlab_message}"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compile Markdown/plain text into document files.")
    parser.add_argument("input", nargs="?", default="-", help="Markdown input file, or '-' for stdin.")
    parser.add_argument("--html", dest="html_path", help="Output HTML path.")
    parser.add_argument("--pdf", dest="pdf_path", help="Optional output PDF path printed from HTML.")
    parser.add_argument("--docx", dest="docx_path", help="Optional output DOCX path.")
    parser.add_argument("--xlsx", dest="xlsx_path", help="Optional output XLSX path.")
    parser.add_argument("--pptx", dest="pptx_path", help="Optional output PPTX path.")
    parser.add_argument("--csv", dest="csv_path", help="Optional output CSV path.")
    parser.add_argument(
        "--pdf-engine",
        choices=("auto", "reportlab", "browser"),
        default="auto",
        help="PDF backend. auto tries browser HTML printing first and falls back to ReportLab; reportlab and browser use only that engine.",
    )
    parser.add_argument(
        "--check-reportlab-cjk",
        action="store_true",
        help="Check whether ReportLab can register an embedded CJK font, then exit.",
    )
    parser.add_argument("--title", help="Override the document title.")
    parser.add_argument("--theme", choices=REPORT_THEME_CLI_CHOICES, default=ReportThemeId.Business)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.check_reportlab_cjk:
        ok, message = check_reportlab_cjk()
        print(message)
        return 0 if ok else 1

    markdown_text = strip_trailing_ai_disclaimer(read_input(args.input))
    input_path = None if args.input == "-" else Path(args.input)
    has_explicit_output = any([
        args.html_path,
        args.pdf_path,
        args.docx_path,
        args.xlsx_path,
        args.pptx_path,
        args.csv_path,
    ])
    if args.html_path:
        html_path = Path(args.html_path)
    elif input_path and not has_explicit_output:
        html_path = input_path.with_suffix(".html")
    elif args.pdf_path:
        pdf_path = Path(args.pdf_path)
        html_path = pdf_path.with_suffix(".html")
    else:
        html_path = None

    if not has_explicit_output and html_path is None:
        print("At least one output path is required when reading from stdin", file=sys.stderr)
        return 2

    if html_path:
        html_path.parent.mkdir(parents=True, exist_ok=True)
        html_output = build_html(markdown_text, args.title, args.theme)
        html_path.write_text(html_output, encoding="utf-8")
        print(f"HTML: {html_path}")

    if args.pdf_path:
        pdf_path = Path(args.pdf_path)
        if args.pdf_engine == "browser":
            if html_path is None:
                print("PDF: failed - browser engine requires an HTML path", file=sys.stderr)
                return 1
            ok, message = print_browser_pdf(html_path, pdf_path)
        elif args.pdf_engine == "reportlab":
            ok, message = print_reportlab_pdf(markdown_text, pdf_path, args.title)
        else:
            if html_path is None:
                print("PDF: failed - auto engine requires an HTML path", file=sys.stderr)
                return 1
            ok, message = print_pdf_auto(markdown_text, html_path, pdf_path, args.title)
        if not ok:
            print(f"PDF: failed - {message}", file=sys.stderr)
            return 1
        print(f"PDF: {message}")

    if args.docx_path:
        docx_path = Path(args.docx_path)
        write_docx(markdown_text, docx_path, args.title)
        print(f"DOCX: {docx_path}")

    if args.xlsx_path:
        xlsx_path = Path(args.xlsx_path)
        write_xlsx(markdown_text, xlsx_path, args.title)
        print(f"XLSX: {xlsx_path}")

    if args.pptx_path:
        pptx_path = Path(args.pptx_path)
        write_pptx(markdown_text, pptx_path, args.title)
        print(f"PPTX: {pptx_path}")

    if args.csv_path:
        csv_path = Path(args.csv_path)
        write_csv_output(markdown_text, csv_path, args.title)
        print(f"CSV: {csv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
