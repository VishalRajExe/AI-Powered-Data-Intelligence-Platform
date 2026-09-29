"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems?: number;
  pageSize?: number;
  itemLabel?: string;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  itemLabel = "items",
  onPageChange,
  className = "",
}: PaginationProps) {
  if (totalPages <= 1 && (!totalItems || totalItems <= (pageSize || 10))) {
    return null;
  }

  // Calculate start and end indices
  const startItem = pageSize ? Math.min((currentPage - 1) * pageSize + 1, totalItems ?? 0) : null;
  const endItem = pageSize ? Math.min(currentPage * pageSize, totalItems ?? 0) : null;

  // Generate page numbers to display with smart ellipsis
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, 4, "...", totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1, "...", totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages);
      }
    }
    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 pb-1 border-t border-border/50 text-[12.5px] ${className}`}>
      <div className="text-muted-foreground">
        {totalItems !== undefined && startItem !== null && endItem !== null ? (
          <span>
            Showing <strong className="font-semibold text-foreground">{startItem}</strong> to{" "}
            <strong className="font-semibold text-foreground">{endItem}</strong> of{" "}
            <strong className="font-semibold text-foreground">{totalItems}</strong> {itemLabel}
          </span>
        ) : (
          <span>
            Page <strong className="font-semibold text-foreground">{currentPage}</strong> of{" "}
            <strong className="font-semibold text-foreground">{totalPages}</strong>
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {/* First Page */}
        <Button
          variant="outline"
          size="icon"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(1)}
          className="h-7 w-7 bg-card border-border/80 disabled:opacity-30 hover:border-tan/50"
          title="First page"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>

        {/* Previous Page */}
        <Button
          variant="outline"
          size="icon"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="h-7 w-7 bg-card border-border/80 disabled:opacity-30 hover:border-tan/50"
          title="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>

        {/* Page Numbers */}
        <div className="flex items-center gap-1 mx-1">
          {pageNumbers.map((p, idx) => {
            if (p === "...") {
              return (
                <span key={`dots-${idx}`} className="px-1.5 text-muted-foreground text-xs select-none">
                  …
                </span>
              );
            }
            const isCurrent = p === currentPage;
            return (
              <Button
                key={`page-${p}`}
                variant="outline"
                size="sm"
                onClick={() => onPageChange(p as number)}
                className={`h-7 min-w-[28px] px-2 text-xs font-medium transition-all ${
                  isCurrent
                    ? "bg-tan/15 text-tan border-tan/60 font-bold shadow-xs hover:bg-tan/20"
                    : "bg-card border-border/80 text-muted-foreground hover:text-foreground hover:border-tan/40"
                }`}
              >
                {p}
              </Button>
            );
          })}
        </div>

        {/* Next Page */}
        <Button
          variant="outline"
          size="icon"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="h-7 w-7 bg-card border-border/80 disabled:opacity-30 hover:border-tan/50"
          title="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>

        {/* Last Page */}
        <Button
          variant="outline"
          size="icon"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(totalPages)}
          className="h-7 w-7 bg-card border-border/80 disabled:opacity-30 hover:border-tan/50"
          title="Last page"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
