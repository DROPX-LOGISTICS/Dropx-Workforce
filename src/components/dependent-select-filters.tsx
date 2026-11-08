"use client";
import React, {useEffect, useMemo, useState, type ReactNode} from 'react';
import {facetRows, type FacetDimension} from '@/lib/dependent-filters';
export type FilterTuple = Record<string, string | string[] | null>;
/** Supply complete authorized filter tuples before pagination; never current-page records. */
export function DependentSelectFilters({rows, initial, children}: {rows: FilterTuple[]; initial: Record<string,string[]>; children: ReactNode}) {
  const [selected, setSelected] = useState(initial);
  const initialKey = JSON.stringify(initial);
  useEffect(() => setSelected(initial), [initialKey]);
  const facets = useMemo(() => {
    const dimensions: Record<string,FacetDimension<FilterTuple>> = {};
    for (const key of Object.keys(initial)) dimensions[key] = {selected:selected[key] ?? [], values:row=>row[key]};
    return facetRows(rows, dimensions);
  }, [rows, selected, initialKey]);
  function visit(child: ReactNode): ReactNode {
    if (!React.isValidElement<{children?:ReactNode;name?:string}>(child)) return child;
    const key = child.props.name;
    if (child.type === 'select' && key && Object.hasOwn(initial,key)) {
      const allowed = new Set(facets.values(key));
      return React.cloneElement(child,{},React.Children.toArray(child.props.children).flatMap(option => {
        if (React.isValidElement(option) && option.type === React.Fragment) return React.Children.toArray((option.props as {children:ReactNode}).children);
        return [option];
      }).filter(option => {
        if (!React.isValidElement<{value?:string;children?:ReactNode}>(option) || option.type!=='option') return true;
        const value=String(option.props.value ?? option.props.children ?? '');
        return ['', 'all', 'ALL'].includes(value) || allowed.has(value);
      }));
    }
    return child.props.children ? React.cloneElement(child,{},React.Children.map(child.props.children,visit)) : child;
  }
  return <div style={{display:'contents'}} onChange={event=>{
    const target=event.target;
    if (target instanceof HTMLSelectElement && Object.hasOwn(initial,target.name)) setSelected(current=>({...current,[target.name]:['','all','ALL'].includes(target.value)?[]:[target.value]}));
  }}>{React.Children.map(children,visit)}</div>;
}
