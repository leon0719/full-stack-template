import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomePage } from "@/pages/home";

function renderWithRouter(ui: React.ReactNode) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{ui}</>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("HomePage", () => {
  it("renders the template heading", async () => {
    renderWithRouter(<HomePage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /React FSD Template/i })).toBeInTheDocument(),
    );
  });
});
