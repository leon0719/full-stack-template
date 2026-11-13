import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MouseEvent, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const history = { canGoBack: vi.fn(() => false), back: vi.fn() };

vi.mock("@tanstack/react-router", () => ({
  // 真的 Link 由 router 處理導頁;jsdom 不支援整頁導覽,所以元件處理完 onClick 後擋掉預設行為
  Link: ({
    children,
    to,
    onClick,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        e.preventDefault();
      }}
    >
      {children}
    </a>
  ),
  useRouter: () => ({ history }),
}));

import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  afterEach(() => {
    history.back.mockClear();
  });

  it("renders the heading, description and actions without a back link by default", () => {
    render(
      <PageHeader
        title="訂單"
        description="全部訂單"
        actions={<button type="button">匯出</button>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "訂單" })).toBeInTheDocument();
    expect(screen.getByText("全部訂單")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "匯出" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("sets the document title and restores it on unmount", () => {
    const { unmount } = render(<PageHeader title="訂單" />);
    expect(document.title).toBe("訂單 · App");
    unmount();
    expect(document.title).toBe("App");
  });

  it("goes back in history when possible, otherwise follows the link", async () => {
    history.canGoBack.mockReturnValue(true);
    const { unmount } = render(<PageHeader title="明細" backTo="/orders" />);
    const link = screen.getByRole("link", { name: "返回" });
    expect(link).toHaveAttribute("href", "/orders");
    await userEvent.click(link);
    expect(history.back).toHaveBeenCalledTimes(1);
    unmount();

    history.canGoBack.mockReturnValue(false);
    render(<PageHeader title="明細" backTo="/orders" />);
    await userEvent.click(screen.getByRole("link", { name: "返回" }));
    expect(history.back).toHaveBeenCalledTimes(1);
  });
});
