import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppShell from "@/components/AppShell";
import DashboardPage from "@/features/dashboard/DashboardPage";
import SuppliersPage from "@/features/suppliers/SuppliersPage";
import NewComparisonWizard from "@/features/imports/NewComparisonWizard";
import ResultsPage from "@/features/comparisons/ResultsPage";
import HistoryPage from "@/features/comparisons/HistoryPage";
import EquivalencesPage from "@/features/equivalences/EquivalencesPage";

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/comparisons/new" element={<NewComparisonWizard />} />
          <Route path="/comparisons/:sessionId" element={<ResultsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/equivalences" element={<EquivalencesPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
