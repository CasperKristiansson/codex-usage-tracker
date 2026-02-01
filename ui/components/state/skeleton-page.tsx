import { Skeleton } from "@/components/ui/skeleton";

const SkeletonPage = () => {
  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-6 px-6 pb-10 pt-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
};

export { SkeletonPage };
