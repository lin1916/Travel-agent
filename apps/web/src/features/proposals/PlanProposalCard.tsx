import { useState } from 'react';
import type { CandidatePlace, PlanProposal } from '@travel/contracts';
import type { ApiClient } from '../../lib/api-client';

function money(cents: number): string { return `¥${(cents / 100).toFixed(0)}`; }

export function PlanProposalCard({ conversationId, proposal, contextVersion, planVersion, client, onAccepted, onChanged }: {
  conversationId: string;
  proposal: PlanProposal;
  contextVersion: number;
  planVersion: number;
  client: ApiClient;
  onAccepted: (result: Awaited<ReturnType<ApiClient['acceptProposal']>>) => Promise<void> | void;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function acceptPlace(placeId: string) {
    setBusy(true);
    setError('');
    try {
      await client.acceptProposalPlace(conversationId, proposal.id, placeId, proposal.version);
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '暂时无法加入候选。');
    } finally {
      setBusy(false);
    }
  }

  async function acceptAll() {
    setBusy(true);
    setError('');
    try {
      const result = await client.acceptProposal(conversationId, proposal.id, {
        expectedProposalVersion: proposal.version,
        expectedPlanningContextVersion: contextVersion,
        expectedPlanVersion: planVersion,
      });
      await onAccepted(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '暂时无法接受这份行程。');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setError('');
    try {
      await client.rejectProposal(conversationId, proposal.id, proposal.version);
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '暂时无法拒绝这份行程。');
    } finally {
      setBusy(false);
    }
  }

  return <section className="proposal-card section-block" aria-labelledby="proposal-title">
    <div className="section-heading"><div><span className="eyebrow">REVIEW BEFORE SAVING</span><h2 id="proposal-title">行程提案</h2></div><span className="status-badge status-running">待确认</span></div>
    {proposal.reasoningSummary && <p className="proposal-card__summary">{proposal.reasoningSummary}</p>}
    <ul className="proposal-card__places" aria-label="提案地点">
      {proposal.proposedPlaces.map(place => <li key={place.id}><div><strong>{place.name}</strong><span>{place.city} · {place.category}</span><small>{place.address}</small></div><button type="button" className="icon-action" aria-label={`加入候选：${place.name}`} title="加入候选" disabled={busy} onClick={() => void acceptPlace(place.id)}><span aria-hidden="true">＋</span></button></li>)}
    </ul>
    <div className="proposal-card__itinerary"><strong>{proposal.itinerary.length} 项安排</strong><span>预计 {money(proposal.budgetSummary.estimatedTotal.amountCents)}</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="proposal-card__actions"><button type="button" onClick={() => void acceptAll()} disabled={busy}>{busy ? '处理中…' : '接受行程'}</button><button type="button" className="button-secondary" onClick={() => void reject()} disabled={busy}>拒绝</button></div>
  </section>;
}

export function acceptedCandidatesFromProposal(result: { candidates: CandidatePlace[] }): CandidatePlace[] {
  return result.candidates;
}
