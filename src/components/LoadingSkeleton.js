export default function LoadingSkeleton({ type = 'card', count = 1 }) {
  const items = Array(count).fill(null);

  if (type === 'table') {
    return (
      <div className="bg-white rounded-lg shadow animate-pulse">
        <div className="border-b px-4 py-3">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
        </div>
        <div className="divide-y">
          {items.map((_, idx) => (
            <div key={idx} className="px-4 py-3 flex items-center gap-4">
              <div className="h-4 bg-gray-200 rounded flex-1"></div>
              <div className="h-4 bg-gray-200 rounded w-24"></div>
              <div className="h-4 bg-gray-200 rounded w-32"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'list') {
    return (
      <div className="space-y-3">
        {items.map((_, idx) => (
          <div key={idx} className="bg-white rounded-lg shadow p-4 animate-pulse">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 animate-pulse">
      <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
      <div className="space-y-3">
        <div className="h-4 bg-gray-200 rounded w-full"></div>
        <div className="h-4 bg-gray-200 rounded w-5/6"></div>
        <div className="h-4 bg-gray-200 rounded w-4/6"></div>
      </div>
    </div>
  );
}

export function ButtonSkeleton() {
  return (
    <div className="h-10 bg-gray-200 rounded-md w-24 animate-pulse"></div>
  );
}

export function InputSkeleton() {
  return (
    <div className="h-10 bg-gray-200 rounded-md w-full animate-pulse"></div>
  );
}