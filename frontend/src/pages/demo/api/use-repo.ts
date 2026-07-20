import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/shared/api";

export interface Repo {
  full_name: string;
  stargazers_count: number;
}

export function useRepo() {
  return useQuery({
    queryKey: ["repo", "facebook/react"],
    queryFn: () => apiGet<Repo>("https://api.github.com/repos/facebook/react"),
  });
}
