import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectView from "../ProjectView";

const mockNavigate = vi.fn();

vi.mock("react-router", () => ({
  useParams: () => ({ id: "test-project-id" }),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../lib/database", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
  }),
}));

vi.mock("../../lib/downloader", () => ({
  ensureOutputDir: vi.fn().mockResolvedValue(undefined),
  downloadClip: vi.fn(),
  cancelDownload: vi.fn(),
}));

vi.mock("../../lib/llm", () => ({
  analyzeScript: vi.fn(),
}));

const mockProjectState = {
  currentProject: null as null | {
    id: string;
    name: string;
    script_text: string | null;
    output_directory: string | null;
    created_at: string;
    updated_at: string;
  },
  loadProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
};

vi.mock("../../stores/projectStore", () => ({
  useProjectStore: vi.fn(
    (selector: (s: typeof mockProjectState) => unknown) =>
      selector(mockProjectState)
  ),
}));

const mockMomentState = {
  moments: [] as Array<{
    id: string;
    project_id: string;
    script_excerpt: string;
    timestamp_hint: string | null;
    editorial_note: string | null;
    suggestions_json: string | null;
    sort_order: number;
    created_at: string;
  }>,
  loadMoments: vi.fn(),
  saveMoments: vi.fn(),
};

vi.mock("../../stores/momentStore", () => ({
  useMomentStore: vi.fn(
    (selector: (s: typeof mockMomentState) => unknown) =>
      selector(mockMomentState)
  ),
}));

const mockSearchState = {
  results: new Map<string, unknown[]>(),
  searchingMoments: new Set<string>(),
  error: null as string | null,
  loadResults: vi.fn(),
  searchForMoment: vi.fn(),
  searchCustom: vi.fn(),
};

vi.mock("../../stores/searchStore", () => ({
  useSearchStore: vi.fn(
    (selector: (s: typeof mockSearchState) => unknown) =>
      selector(mockSearchState)
  ),
}));

const mockDownloadState = {
  queue: [] as Array<{
    id: string;
    momentId: string;
    videoId: string;
    videoTitle: string;
    startTime: number;
    endTime: number;
    outputPath: string;
    status: string;
    progressLines: string[];
    error: string | null;
  }>,
  downloadedMomentIds: new Set<string>(),
  addToQueue: vi.fn(),
  cancelDownload: vi.fn(),
  retryDownload: vi.fn(),
  clearCompleted: vi.fn(),
  loadDownloadedMoments: vi.fn(),
};

vi.mock("../../stores/downloadStore", () => ({
  useDownloadStore: vi.fn(
    (selector: (s: typeof mockDownloadState) => unknown) =>
      selector(mockDownloadState)
  ),
}));

describe("ProjectView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectState.currentProject = null;
    mockMomentState.moments = [];
    mockSearchState.results = new Map();
    mockSearchState.searchingMoments = new Set();
    mockSearchState.error = null;
    mockDownloadState.queue = [];
    mockDownloadState.downloadedMomentIds = new Set();
  });

  it("shows loading state when currentProject is null", () => {
    render(<ProjectView />);
    expect(screen.getByText("Loading project...")).toBeInTheDocument();
  });

  it("renders project name when loaded", () => {
    mockProjectState.currentProject = {
      id: "test-project-id",
      name: "My Test Project",
      script_text: "Hello world script",
      output_directory: "/mock/Downloads/ai-broll/my-test-project",
      created_at: "2025-01-15T10:00:00Z",
      updated_at: "2025-01-15T10:00:00Z",
    };
    render(<ProjectView />);
    expect(screen.getByText("My Test Project")).toBeInTheDocument();
  });

  it("shows Script section", () => {
    mockProjectState.currentProject = {
      id: "test-project-id",
      name: "Script Test",
      script_text: null,
      output_directory: "/mock/Downloads/ai-broll/script-test",
      created_at: "2025-01-15T10:00:00Z",
      updated_at: "2025-01-15T10:00:00Z",
    };
    render(<ProjectView />);
    expect(screen.getByText("Script")).toBeInTheDocument();
  });

  it("shows Analysis section", () => {
    mockProjectState.currentProject = {
      id: "test-project-id",
      name: "Analysis Test",
      script_text: null,
      output_directory: "/mock/Downloads/ai-broll/analysis-test",
      created_at: "2025-01-15T10:00:00Z",
      updated_at: "2025-01-15T10:00:00Z",
    };
    render(<ProjectView />);
    expect(screen.getByText("Analysis")).toBeInTheDocument();
  });

  it("shows Downloads section", () => {
    mockProjectState.currentProject = {
      id: "test-project-id",
      name: "Downloads Test",
      script_text: null,
      output_directory: "/mock/Downloads/ai-broll/downloads-test",
      created_at: "2025-01-15T10:00:00Z",
      updated_at: "2025-01-15T10:00:00Z",
    };
    render(<ProjectView />);
    expect(screen.getByText("Downloads")).toBeInTheDocument();
  });

  it("shows Back to projects link", () => {
    mockProjectState.currentProject = {
      id: "test-project-id",
      name: "Back Link Test",
      script_text: null,
      output_directory: "/mock/Downloads/ai-broll/back-link-test",
      created_at: "2025-01-15T10:00:00Z",
      updated_at: "2025-01-15T10:00:00Z",
    };
    render(<ProjectView />);
    expect(screen.getByText("Back to projects")).toBeInTheDocument();
  });
});
