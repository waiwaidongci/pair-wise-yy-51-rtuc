import { inject, Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { map } from 'rxjs'
import type { RoutePackage } from '../types'

@Injectable({ providedIn: 'root' })
export class RouteApiService {
  private readonly http = inject(HttpClient)

  getRoutePackages() {
    return this.http.get<{ items: RoutePackage[] }>('route-data.json').pipe(map((response) => response.items))
  }
}
