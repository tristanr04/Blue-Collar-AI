import Dashboard from '@/pages/Dashboard';
import { MonthlyCheckIn } from '@/components/retention/MonthlyCheckIn';

export default function RetentionDashboard() {
  return (
    <>
      <Dashboard />
      <div className="bg-[#050b15] px-4 pb-28 md:px-8 md:pb-10">
        <div className="mx-auto max-w-6xl">
          <MonthlyCheckIn />
        </div>
      </div>
    </>
  );
}
