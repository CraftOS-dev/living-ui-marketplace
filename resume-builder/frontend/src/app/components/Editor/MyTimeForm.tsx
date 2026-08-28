import React from 'react';
import { useResume } from '../../context/ResumeContext';
import { Plus, Trash2, PieChart } from 'lucide-react';

export const MyTimeForm: React.FC = () => {
  const { resume, addMyTimeItem, updateMyTimeItem, removeMyTimeItem } = useResume();
  const { myTime } = resume;

  const totalPercentage = myTime.reduce((sum, item) => sum + Number(item.percentage || 0), 0);

  return (
    <div className="form-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PieChart size={18} color="var(--accent-primary)" />
            My Time Allocation
          </h3>
          <span style={{ fontSize: '0.75rem', color: totalPercentage === 100 ? '#10b981' : '#f59e0b' }}>
            Total: {totalPercentage}% {totalPercentage !== 100 && '(Recommended to equal 100%)'}
          </span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={addMyTimeItem}>
          <Plus size={14} />
          <span>Add Focus</span>
        </button>
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
        Visually demonstrate how you divide your professional energy (e.g. 35% Architecture, 30% Coding, 20% Mentorship).
      </p>

      {myTime.map((item) => (
        <div key={item.id} className="form-card" style={{ padding: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input 
              type="color"
              value={item.color}
              onChange={(e) => updateMyTimeItem(item.id, { color: e.target.value })}
              style={{ width: '28px', height: '28px', border: 'none', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'transparent' }}
            />
            <input 
              type="text"
              className="form-control"
              style={{ flex: 1 }}
              value={item.label}
              onChange={(e) => updateMyTimeItem(item.id, { label: e.target.value })}
              placeholder="e.g. Coding & Code Review"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input 
                type="number"
                className="form-control"
                style={{ width: '60px' }}
                value={item.percentage}
                onChange={(e) => updateMyTimeItem(item.id, { percentage: Number(e.target.value) })}
                min={1}
                max={100}
              />
              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>%</span>
            </div>
            <button 
              className="btn btn-outline btn-sm" 
              onClick={() => removeMyTimeItem(item.id)}
              style={{ color: '#ef4444', borderColor: 'transparent', padding: '4px 6px' }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
